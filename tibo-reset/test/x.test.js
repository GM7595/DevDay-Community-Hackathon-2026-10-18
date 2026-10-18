import test from 'node:test';
import assert from 'node:assert/strict';
import { AppError } from '../src/common.js';
import { collect, createXClient, normalize } from '../src/x.js';

const own = { id: '10', username: 'demo_account', protected: false };
const other = { id: '20', username: 'reader', protected: false };
const post = (id, extra={}) => ({ id:String(id), author_id:'10', created_at:`2026-10-18T05:${String(Number(id)%60).padStart(2,'0')}:00Z`, text:`Synthetic post ${id}`, ...extra });
const response = (data, next, includes={}) => ({ data, includes, meta:{result_count:data.length,...(next?{next_token:next}:{})} });
const client = (pages, extra={}) => { let i=0;return { getUserByUsername:async()=>({data:own}), getUserPosts:async()=>pages[i++], getPosts:async()=>{throw Error('Unexpected context request');}, ...extra }; };
const options = { username:'demo_account', wait:async()=>{}, now:()=>new Date('2026-10-18T06:00:00Z') };

test('official media expansions retain photos, alt text, static GIF previews and missing image markers', async () => {
  const saved = await collect({...options,count:1,client:client([response([post('5',{attachments:{media_keys:['a','b','missing']}})],null,
    {media:[{media_key:'a',type:'photo',url:'https://pbs.twimg.com/media/meme.jpg',alt_text:'Reset meme'},
      {media_key:'b',type:'animated_gif',preview_image_url:'https://pbs.twimg.com/media/preview.jpg'}]})])});
  assert.equal(saved.posts[0].media[0].altText,'Reset meme');
  assert.equal(saved.posts[0].media[1].type,'animated_gif');
  assert.equal(saved.posts[0].media[2].url,null);
});

test('a known context post with missing media expansion is looked up within the existing cap', async () => {
  let calls = 0;
  const context = post('2',{attachments:{media_keys:['meme']}});
  const api = client([response([post('5',{referenced_posts:[{type:'quoted',id:'2'}]})],null,{posts:[context]})],{
    getPosts:async ids=>{calls++;assert.deepEqual(ids,['2']);return response([context],null,{media:[{media_key:'meme',type:'photo',url:'https://pbs.twimg.com/media/meme.jpg'}]});}
  });
  const saved = await collect({...options,count:1,contextLimit:1,client:api});
  assert.equal(calls,1);assert.equal(saved.contextPostCount,1);
  assert.equal(saved.posts[0].quoted.media[0].url,'https://pbs.twimg.com/media/meme.jpg');
});

test('official client uses Bearer auth, documented fields and read-only api.x.com endpoints', async()=>{
  const requests=[];
  const api=createXClient({env:{X_BEARER_TOKEN:'fake%2Fbearer',X_AUTH_TOKEN:'must-not-be-used',X_CT0:'must-not-be-used'},fetchFn:async(url,init)=>{
    requests.push(new URL(url));assert.equal(new URL(url).origin,'https://api.x.com');assert.equal(init.method,'GET');assert.equal(init.redirect,'manual');
    assert.equal(init.headers.Authorization,'Bearer fake%2Fbearer');assert.ok(!Object.hasOwn(init.headers,'Cookie'));
    return Response.json({data:[]});
  }});
  await api.getUserByUsername('demo_account');await api.getUserPosts('10',{maxResults:100,paginationToken:'next'});await api.getPosts(['1','2','1']);
  assert.deepEqual(requests.map(u=>u.pathname),['/2/users/by/username/demo_account','/2/users/10/tweets','/2/tweets']);
  assert.equal(requests[1].searchParams.get('exclude'),'retweets');assert.equal(requests[1].searchParams.get('max_results'),'100');
  assert.equal(requests[1].searchParams.get('pagination_token'),'next');assert.equal(requests[1].searchParams.get('post.fields'),'created_at,conversation_id,note_post,attachments');
  assert.ok(requests[1].searchParams.get('expansions').includes('referenced_posts'));assert.equal(requests[2].searchParams.get('ids'),'1,2');
  assert.throws(()=>api.getUserPosts('https://other.example/'),/Invalid X/);
  assert.throws(()=>api.getUserByUsername('../other'),/Invalid X username|Invalid X/);
});

test('legacy cookies and guest access cannot bypass the official Bearer Token requirement',()=>{
  assert.throws(()=>createXClient({env:{X_AUTH_TOKEN:'old',X_CT0:'old'}}),/X_BEARER_TOKEN/);
  assert.throws(()=>createXClient({env:{}}),/X_BEARER_TOKEN/);
});

test('normalizes long posts and expanded reply/quote authors, with bounded context depth',()=>{
  const parent=post('1',{author_id:'20'}),quote=post('2',{author_id:'20',note_post:{text:'Full quoted long post'}});
  const raw=post('3',{note_post:{text:'Full long post'},referenced_posts:[{type:'replied_to',id:'1'},{type:'quoted',id:'2'}]});
  const maps={tweets:new Map([parent,quote,raw].map(p=>[p.id,p])),users:new Map([own,other].map(u=>[u.id,u]))};
  const saved=normalize(raw,maps);assert.equal(saved.text,'Full long post');assert.equal(saved.parent.author,'reader');assert.equal(saved.quoted.text,'Full quoted long post');assert.equal(saved.replyToId,'1');
  parent.referenced_posts=[{type:'replied_to',id:'3'}];assert.equal(normalize(raw,maps).parent.parent,null);
  assert.equal(normalize({...raw,author_id:'unknown'},maps),null);
  assert.equal(normalize({...raw,created_at:'invalid'},maps),null);
  maps.users.set('20',{...other,protected:true});assert.equal(normalize(raw,maps).parent,null);
});

test('paginates and deduplicates authored posts/replies, excluding reposts and foreign authors',async()=>{
  const pages=[response([post('5'),post('4',{referenced_posts:[{type:'replied_to',id:'5'}]}),post('3',{referenced_posts:[{type:'retweeted',id:'99'}]})],'next'),
    response([post('4',{referenced_posts:[{type:'replied_to',id:'5'}]}),post('2'),post('1',{author_id:'20'})])];
  const saved=await collect({...options,count:3,client:client(pages)});
  assert.deepEqual(saved.posts.map(p=>p.id),['5','4','2']);assert.equal(saved.posts[1].parent.id,'5');assert.equal(saved.pages,2);assert.equal(saved.source,'x-official-api');
});

test('a complete first page needs no extra pinned-post request',async()=>{
  let calls=0;const api=client([],{getUserPosts:async()=>{calls++;return response(Array.from({length:100},(_,i)=>post(i+1)),'next');}});
  const saved=await collect({...options,count:100,client:api,contextLimit:0});assert.equal(calls,1);assert.equal(saved.posts.length,100);
});

test('unusable post bodies do not displace an eligible post from the requested count',async()=>{
  const pages=[response([post('5'),post('4',{text:''})],'next'),response([post('3')])];
  const saved=await collect({...options,count:2,client:client(pages)});
  assert.deepEqual(saved.posts.map(p=>p.id),['5','3']);assert.equal(saved.pages,2);
});

test('uses expansions first, then batches and caps missing context; deleted posts remain unknown',async()=>{
  const calls=[];const api=client([response([post('5',{referenced_posts:[{type:'replied_to',id:'1'}]}),post('4',{referenced_posts:[{type:'quoted',id:'2'}]}),post('3',{referenced_posts:[{type:'replied_to',id:'90'}]})],null)],{
    getPosts:async ids=>{calls.push(ids);return {data:[post('1',{author_id:'20'})],includes:{users:[other],posts:[{id:'3',text:'Partial expansion'}]},errors:[{resource_id:'2',title:'Not Found'}]};}
  });
  const saved=await collect({...options,count:3,contextLimit:2,client:api});assert.deepEqual(calls,[['1','2']]);assert.equal(saved.contextPostCount,2);assert.equal(saved.contextRequests,1);assert.equal(saved.posts[0].parent.author,'reader');assert.equal(saved.posts[1].quoted,null);assert.equal(saved.posts[2].parent,null);assert.match(saved.warnings.join(' '),/partial resources|parents missing/);
  assert.equal(saved.posts.length,3);assert.equal(saved.posts[2].text,'Synthetic post 3');
});

test('expanded context avoids extra API calls and cannot be attributed to the target account',async()=>{
  const api=client([response([post('5',{referenced_posts:[{type:'quoted',id:'2'}]})],null,{posts:[post('2',{author_id:'20'})],users:[other]})]);
  const saved=await collect({...options,count:1,client:api});assert.equal(saved.contextRequests,0);assert.equal(saved.posts[0].quoted.author,'reader');
});

test('repeated cursors, short timelines, empty and protected accounts do not invent data',async()=>{
  const saved=await collect({...options,count:4,client:client([response([post('1')],'same'),response([post('1')],'same')])});
  assert.equal(saved.stopReason,'repeated_cursor');assert.equal(saved.posts.length,1);assert.match(saved.warnings.join(' '),/1\/4|obtained 1/);
  await assert.rejects(collect({...options,client:client([response([])])}),/no eligible/);
  await assert.rejects(collect({...options,client:client([],{getUserByUsername:async()=>({data:{...own,protected:true}})})}),/Only public/);
});

test('auth, access, billing and rate-limit errors are distinct, stop immediately and hide response bodies',async()=>{
  const codes={401:'x_auth',402:'x_credits',403:'x_access',429:'x_rate_limit',302:'x_request'};
  for(const [status,code] of Object.entries(codes)){
    let calls=0;const api=createXClient({env:{X_BEARER_TOKEN:'fake-secret'},fetchFn:async()=>{calls++;return new Response('private upstream body fake-secret',{status:Number(status),headers:{'x-rate-limit-reset':'1792306800',Location:'https://other.example/'}});}});
    await assert.rejects(api.getUserByUsername('demo_account'),error=>error instanceof AppError&&error.code===code&&!/private|fake-secret/.test(error.message));assert.equal(calls,1);
  }
  const api=createXClient({env:{X_BEARER_TOKEN:'fake'},fetchFn:async()=>new Response('invalid JSON')});await assert.rejects(api.getPosts(['1']),/invalid JSON/);
});

test('context rate-limit failures abort instead of silently returning an incomplete forecast corpus',async()=>{
  const error=new AppError('X API rate limit reached (HTTP 429).');error.code='x_rate_limit';
  const api=client([response([post('5',{referenced_posts:[{type:'replied_to',id:'1'}]})])],{getPosts:async()=>{throw error;}});
  await assert.rejects(collect({...options,count:1,client:api}),error);
});
