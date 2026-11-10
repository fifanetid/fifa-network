require("dotenv").config();
const app = require("./app");

const port = Number(process.env.PORT || 3000);
app.listen(port, "127.0.0.1", () => {
  console.log(`FIFA NETWORK web started at http://127.0.0.1:${port}`);
});
