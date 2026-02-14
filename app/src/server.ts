import app from './app';

const PORT = Number(process.env.PORT ?? 3000);
const HOST = "0.0.0.0";

app.listen(PORT, HOST, () => {
  console.log(`🚀 Server is running at http://${HOST}:${PORT}`);
});

