import express from "express";
import bodyParser from "body-parser";
import pg from "pg";
import bcrypt from "bcrypt";
import session from "express-session";
import passport from "passport";
import {Strategy} from "passport-local";
import env from "dotenv";

env.config();

const app = express();
const port = 3000;
const saltRounds = 10;
env.config();
// Siempre se inicia primero la sesión antes que el passport
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
  })
);

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));

app.use(passport.initialize());
app.use(passport.session());

// Middleware para hacer que el usuario esté disponible en todas las vistas
app.use((req, res, next) => {
  res.locals.user = req.user; // Almacena el usuario en res.locals
  next();
});

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


app.get("/", (req, res) => {
  res.render("index.ejs");
});

app.get("/login", (req, res) => {
  res.render("index.ejs");
});

const departamentos = await db.query("SELECT * FROM departamentos");

app.get("/registro", async (req, res) => {
  res.render("registro.ejs", {departamentos: departamentos.rows});
})

app.get("/inicio", (req, res) =>{
  if (req.isAuthenticated()){
    res.render("inicio.ejs");
  } else {
    res.redirect("/login")
  }
});

app.get("/cerrar-sesion", (req, res) => {
  req.logout(function (err) {
    if (err) {
      return next(err);
    }
    res.redirect("/");
  });
});

// Envío del formulario de inicio de sesión
app.post("/login", (req, res, next) => {
  passport.authenticate("local", (err, user, info) => {
    if (err) {
      return next(err); // Si ocurre un error inesperado
    }
    if (!user) {
      // Renderizar de nuevo el formulario de login con el mensaje de error
      return res.render("index.ejs", { error: info.message });
    }
    req.logIn(user, (err) => {
      if (err) {
        return next(err);
      }
      return res.redirect("/inicio");
    });
  })(req, res, next);
});


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
          console.log("Error al hashear contraseña:", err);
        }else {
          const consulta = await db.query("INSERT INTO usuarios(nombre, apellidos, nombre_usuario, id_departamento, contraseña) VALUES($1, $2, $3, $4, $5) RETURNING *",
            [nombres, apellidos, usuario, departamento, hash]
          );
          const objUsuario = consulta.rows[0];
          req.login(objUsuario, (err) => {
            console.log("Login exitoso.")
            res.redirect("/inicio");
          });
        }
      });
    } else {
      res.render("registro.ejs", {error: "Las contraseñas no coinciden.", departamentos: departamentos.rows});
    }
    
  }

});

passport.use(
  new Strategy({
    usernameField: 'usuario',  // Campo 'usuario' del formulario
    passwordField: 'contraseña' // Campo 'contraseña' del formulario
  },
  async function verify(usuario, contraseña, cb) {
    try {
      const result = await db.query("SELECT * FROM usuarios WHERE nombre_usuario = $1 ", [
        usuario,
      ]);
      if (result.rows.length > 0) {
        const user = result.rows[0];
        const storedHashedPassword = user.contraseña;
        bcrypt.compare(contraseña, storedHashedPassword, (err, valid) => {
          if (err) {
            //Error with password check
            return cb(err);
          } else {
            if (valid) {
              //Passed password check
              return cb(null, user);
            } else {
              //Did not pass password check
              return cb(null, false, {message: "Contraseña Incorrecta."});
            }
          }
        });
      } else {
        return cb(null, false, { message: "Usuario no encontrado." });
      }
    } catch (err) {
      console.log(err);
    }
  })
);

passport.serializeUser((user, cb) => {
  cb(null, user);
});

passport.deserializeUser((user, cb) => {
  cb(null, user);
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
  