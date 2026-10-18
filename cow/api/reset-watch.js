import { handleResetWatch } from "../src/reset-watch.js";

export default async function handler(req, res) {
  const response = await handleResetWatch({ method: req.method });
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  res.end(req.method === "HEAD" ? undefined : await response.text());
}
