import express from "express";
import bodyParser from "body-parser";
import pg from "pg";
import bcrypt from "bcrypt";
import session from "express-session";
import { cp } from "fs";

const app = express();
const port = 3000;
const saltRounds = 10;

const db = new pg.Client({
  user: "postgres",
  host: "localhost",
  database: "gestionTec",
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

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));

// app.use(session({
//   secret: "contraseña", 
//   resave: false,
//   saveUninitialized: true,
//   cookie: { maxAge: 60000 } // Tiempo de vida de la sesión (en milisegundos)
// }));


// app.use((req, res, next) => {
//   res.locals.nombre = req.session.nombre;
//   res.locals.departamento = req.session.departamento;
//   next();
// });

app.get("/", (req, res) => {
  res.render("index.ejs");
});

app.get("/login", (req, res) => {
  res.render("index.ejs");
});

// Envío del formulario de inicio de sesión
app.post("/login", async (req, res) => {

  let usuario_login = req.body["usuario"];
  let contraseña_login = req.body["contraseña"];

  const consulta_usuario = await db.query("SELECT * FROM usuarios WHERE nombre_usuario = $1", [usuario_login]);
  
  if (consulta_usuario.rows.length > 0){
    const usuario = consulta_usuario.rows[0];
    const contraseñaHasheada = usuario.contraseña; 

    bcrypt.compare(contraseña_login, contraseñaHasheada, (err, result) => {
      if (err) {
        console.log("Error al comparar contradeñas: ", err);
      } else {
        if (result){
          res.render("inicio.ejs");
        } else {
          res.render("index.ejs", {error: "Contraseña incorrecta."});
        }
      }
    });

  } else {
    res.render("index.ejs", {error: "Usuario no encontrado."});
  }

});

const departamentos = await db.query("SELECT * FROM departamentos");

app.get("/registro", async (req, res) => {
  res.render("registro.ejs", {departamentos: departamentos.rows});
})

app.post("/registro", async (req, res) =>{

  const nombres = req.body.nombre;
  const apellidos = req.body.apellidos;
  const usuario = req.body.nombreUsuario;
  const departamento = req.body.departamento;
  const contraseña = req.body.registroContraseña;
  const confContraseña = req.body.confirmarRegistroContraseña;

  const consultaCheck = await db.query("SELECT * FROM usuarios WHERE nombre_usuario = $1", [usuario]);

  if (consultaCheck.rows.length > 0){
    res.render("registro.ejs", { departamentos: departamentos.rows, error: "Nombre de usuario no disponible." });
  } else {

    if (contraseña == confContraseña){
      bcrypt.hash(contraseña, saltRounds, async (err, hash) => {
        if(err){
          console.log("Error al hashear contraseña.");
        }else {
          await db.query("INSERT INTO usuarios(nombre, apellidos, nombre_usuario, id_departamento, contraseña) VALUES($1, $2, $3, $4, $5)",
            [nombres, apellidos, usuario, departamento, hash]
          );
          res.render("index.ejs");
        }
      });
    } else {
      res.render("registro.ejs", { departamentos: departamentos.rows, error: "Las contraseñas no coinciden." });
    }
  }

});

app.get("/inicio", (req, res) =>{

  // if (req.session.usuario) {
  //   res.render("inicio.ejs", { nombre: req.session.nombre, departamento: req.session.departamento });
  // } else {
  //   res.redirect("/");
  // }

  res.render("inicio.ejs");
});



app.get("/cerrar-sesion", (req, res) => {
  // req.session.destroy((err) => {
  //   if (err) {
  //     return console.log(err);
  //   }
  //   res.redirect("/");
  // });
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
  