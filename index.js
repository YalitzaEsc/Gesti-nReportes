import express from "express";

const app = express();
const port = 3000;

app.use(express.static("public"));

app.get("/", (req, res) => {
  res.render("index.ejs");
});

app.get("/inicio", (req, res) => {
  res.render("inicio.ejs");
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
  