const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");

const port = process.env.PORT || 3000;
const dir = path.join(__dirname, "public");
const mime = {
  ".html": "text/html;charset=utf-8",
  ".css": "text/css;charset=utf-8",
  ".js": "application/javascript;charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".ttf": "font/ttf",
  ".woff": "font/woff",
  ".woff2": "font/woff2"
};

const blackUA = ["curl", "wget", "httpie", "aria2", "python-requests", "python", "java", "perl", "ruby", "php", "scrapy", "spider", "bot", "crawler", "scraper", "headless", "phantomjs", "selenium"];
function isBot(ua) {
  if (!ua) return true;
  const l = ua.toLowerCase();
  if (blackUA.some(k => l.includes(k))) return true;
  // UA 中不包含任何浏览器标识
  if (!l.includes("mozilla") && !l.includes("opera") && !l.includes("edg/") && !l.includes("chrome") && !l.includes("safari") && !l.includes("trident") && !l.includes("firefox")) return true;
  return false;
}

function setSecurityHeaders(res) {
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
}

function proxyRequest(req, res, clientBody, targetHostOverride) {
  const targetHost = targetHostOverride || req.headers["x-target-host"] || "http://110.42.38.161:5032";
  const parsed = url.parse(targetHost);
  const targetBase = targetHost.replace(/\/+$/, "");

  const options = {
    hostname: parsed.hostname,
    port: parsed.port || 80,
    path: req.url.replace(/^\/proxy/, "").replace(/[?&]_t=[^&]*/, ""),
    method: req.method,
    headers: {}
  };

  // 透传必要 headers，去掉代理专用的
  const skip = ["x-target-host", "host", "connection"];
  for (const key of Object.keys(req.headers)) {
    if (!skip.includes(key.toLowerCase())) {
      options.headers[key] = req.headers[key];
    }
  }
  // 设置正确的 host
  options.headers["host"] = parsed.host;

  const lib = parsed.protocol === "https:" ? require("https") : http;
  const proxyReq = lib.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });
  proxyReq.on("error", (e) => {
    res.writeHead(502);
    res.end("proxy error: " + e.message);
  });
  if (clientBody) proxyReq.write(clientBody);
  proxyReq.end();
}

http.createServer((req, res) => {
  const ua = req.headers["user-agent"] || "";

  // 图片代理不检查 UA（img 标签发起的请求）
  const isImgProxy = req.url.indexOf("/proxy/api/report/image/") === 0;
  if (!isImgProxy && isBot(ua)) {
    res.writeHead(403);
    res.end();
    return;
  }
  if (!isImgProxy && !req.headers.accept) {
    res.writeHead(403);
    res.end();
    return;
  }
  // 无 Accept-Language 的请求大概率是命令行工具（浏览器一定带）
  if (!isImgProxy && !req.headers["accept-language"]) {
    res.writeHead(403);
    res.end();
    return;
  }

  // API 代理
  if (req.url.indexOf("/proxy/") === 0) {
    const parsedUrl = url.parse(req.url, true);
    const targetOverride = parsedUrl.query._t || null;
    const cleanUrl = req.url.replace(/[?&]_t=[^&]*/, "");
    const chunks = [];
    req.on("data", c => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      // 临时替换 url 用于代理
      const origUrl = req.url;
      req.url = cleanUrl;
      proxyRequest(req, res, body.length > 0 ? body : undefined, targetOverride);
      req.url = origUrl;
    });
    return;
  }

  // 静态文件
  let f = req.url.split("?")[0];
  if (f === "/") f = "/index.html";
  const fp = path.join(dir, f);
  if (!fp.startsWith(dir)) { res.writeHead(403); res.end(); return; }

  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404); res.end("not found"); return; }
    const ext = path.extname(fp).toLowerCase();
    setSecurityHeaders(res);
    res.writeHead(200, { "Content-Type": mime[ext] || "application/octet-stream" });
    res.end(data);
  });
}).listen(port, "0.0.0.0", () => {
  const pidFile = process.env.PID_FILE || path.join(require("os").tmpdir(), "sfw_pid.tmp");
  try { fs.writeFileSync(pidFile, process.pid.toString()); } catch (e) {}
  console.log("Static server on http://0.0.0.0:" + port);
});
