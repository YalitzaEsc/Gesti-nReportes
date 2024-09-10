import express from "express";
import bodyParser from "body-parser";
import pg from "pg";
import session from "express-session";

const app = express();
const port = 3000;

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));

app.use(session({
  secret: "contraseña", 
  resave: false,
  saveUninitialized: true,
  cookie: { maxAge: 60000 } // Tiempo de vida de la sesión (en milisegundos)
}));

const db = new pg.Client({
  user: "postgres",
  host: "localhost",
  database: "gestion",
  password: "98490133",
  port: 5432,
});

db.connect((err) =>{
  if(err){
    console.log(err.stack)
  } else {
    console.log("Connected.")
  }
});

app.use((req, res, next) => {
  res.locals.nombre = req.session.nombre;
  res.locals.departamento = req.session.departamento;
  next();
});

app.get("/", (req, res) => {
  res.render("index.ejs");
});

app.get("/registro", (req, res) => {
  res.render("registro.ejs");
})

app.get("/inicio", (req, res) =>{
  if (req.session.usuario) {
    res.render("inicio.ejs", { nombre: req.session.nombre, departamento: req.session.departamento });
  } else {
    res.redirect("/");
  }
});

// Envío del formulario de inicio de sesión
app.post("/submit", async (req, res) => {

  let usuario = req.body["usuario"];
  let contraseña = req.body["contraseña"];

  const consulta_usuario = await db.query("SELECT * FROM usuarios WHERE username = $1", [usuario]);
  
  if (consulta_usuario.rows.length > 0){
    const obj_usuario = consulta_usuario.rows[0];
    if(contraseña == obj_usuario.contraseña){
      const consulta_departamento = await db.query("SELECT nombre FROM departamentos WHERE id_departamento = $1", [obj_usuario.id_departamento]);
      const nombre_departamento = consulta_departamento.rows[0];    

      req.session.usuario = obj_usuario.username;
      req.session.nombre = obj_usuario.nombre;
      req.session.departamento = nombre_departamento;

      res.render("inicio.ejs", {nombre: obj_usuario.nombre, departamento: nombre_departamento.nombre});
    } else {
      res.render("index.ejs", {error: "Contraseña Incorrecta."});
    }
  } else {
    res.render("index.ejs", {error: "Usuario no encontrado."});
  }

});

app.get("/cerrar-sesion", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return console.log(err);
    }
    res.redirect("/");
  });
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
  