import { createApp } from "./app.js";

const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || (process.env.NODE_ENV === "production" ? "127.0.0.1" : "0.0.0.0");
const { app } = createApp();

app.listen(port, host, () => {
  console.log(`迹屿服务已启动：http://${host}:${port}`);
});
