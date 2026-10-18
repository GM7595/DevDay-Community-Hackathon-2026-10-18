import { handleDecision } from "../src/decisions.js";

export default async function handler(req, res) {
  let body = req.body;
  if (typeof body !== "string" && req.method === "POST") body = JSON.stringify(body ?? {});
  const request = {
    method: req.method,
    body,
    ip: req.socket?.remoteAddress,
  };
  const response = await handleDecision(request);
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  const text = await response.text();
  res.end(text);
}
