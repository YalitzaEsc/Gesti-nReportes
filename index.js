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
    cookie: { maxAge: 24 * 60 * 60 * 1000 }, // 24 horas
  })
);

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));
app.use(passport.initialize());
app.use(passport.session());

app.set('view engine', 'ejs');
app.set('views', 'views');

// Middleware para hacer que el usuario esté disponible en todas las vistas
app.use((req, res, next) => {
  res.locals.user = req.user; // Almacena el usuario en res.locals
  next();
});

const db = new pg.Client({
  user: process.env.PG_USER,
  host: process.env.PG_HOST,
  database: process.env.PG_DATABASE,
  password: process.env.PG_PASSWORD,
  port: process.env.PG_PORT,
});

db.connect((err) =>{
  if(err){
    console.log(err.stack)
  } else {
    console.log("Connected.")
  }
});


app.get("/", (req, res) => {
  if (req.isAuthenticated()){
    res.render("inicio.ejs");
  } else {
    res.redirect("/login")
  }
});

app.get("/login", (req, res) => {
  res.render("index.ejs");
});

const departamentos = await db.query("SELECT * FROM departamentos");

app.get("/registro", (req, res) => {
  if (req.isAuthenticated()) {
    if (req.user.nombre_usuario === 'Administrador') {
      res.render("registro.ejs", {departamentos: departamentos.rows});
    } else {
      res.redirect("/inicio");  
    }
  } else {
    res.redirect("/login");
  }
});

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

app.get('/modal', async(req, res) => {

  const usuario = res.locals.user;
  const id_departamento = usuario.id_departamento;

  const { id_localidad, nombreLocalidad, encargadoLocalidad } = req.query;
        
  const departamento = await db.query("SELECT nombre FROM departamentos WHERE id_departamento = $1", [id_departamento]);
  const edificios = await db.query("SELECT * FROM edificios WHERE id_departamento = $1 ORDER BY nombre ASC", [id_departamento]);
        
  // Cambiar a tipos_elemento
  const tipos = await db.query("SELECT * FROM tipos_elemento");

  const id_encargado = req.body.id_encargado;
  const encargado = (await db.query("SELECT nombre FROM encargados WHERE id_encargado = $1", [id_encargado])).rows[0];

  // Inicializa la variable tipoSeleccionado
  const tipoSeleccionado = req.query.tipo || null; 
  const localidadesPorEdificio = {};

        for (const edificio of edificios.rows) {
            const localidades = await db.query(`
                SELECT localidades.*, tipos.nombre AS nombre_tipo, encargados.nombre AS nombre_encargado 
                FROM localidades 
                JOIN tipos ON localidades.id_tipo = tipos.id_tipo 
                LEFT JOIN encargados ON localidades.id_encargado = encargados.id_encargado 
                WHERE id_edificio = $1 ${tipoSeleccionado ? 'AND tipos.id_tipo = $2' : ''}
                ORDER BY localidades.nombre ASC
            `, tipoSeleccionado ? [edificio.id_edificio, tipoSeleccionado] : [edificio.id_edificio]);

            // Obtener componentes para cada localidad
            for (const localidad of localidades.rows) {
                const componentes = await db.query(`
                    SELECT * FROM elementos 
                    WHERE id_localidad = $1 
                    ORDER BY nombre ASC
                `, [localidad.id_localidad]);

                localidad.componentes = componentes.rows; // Agregar los componentes a la localidad
            }
            localidadesPorEdificio[edificio.id_edificio] = localidades.rows;
        }

  res.render('modal', { id_localidad, nombreLocalidad, encargadoLocalidad, departamento: departamento.rows[0], 
    id_departamento: id_departamento, 
    edificios: edificios.rows, 
    tipos: tipos.rows, 
    localidadesPorEdificio: localidadesPorEdificio, 
    encargado: encargado,
    tipoSeleccionado, });
});


// Modal incidencias

app.get('/modalIncidencias', async (req, res) => {
  const usuario = res.locals.user;
  const id_departamento = usuario.id_departamento;

  res.render('modalIncidencias');
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
  const cargo = req.body.cargo;
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
          await db.query("INSERT INTO usuarios(nombre, apellidos, contraseña, id_departamento, nombre_usuario, puesto) VALUES($1, $2, $3, $4, $5, $6)", [nombres, apellidos, hash, departamento, usuario, cargo]);
          res.render("registro.ejs", {exito: "Usuario registrado con éxito.", departamentos: departamentos.rows});
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


  // Sidebar

  app.get("/perfil", async (req, res) => {

    if (req.isAuthenticated()){
      const usuario = res.locals.user;
      const id_departamento = usuario.id_departamento;
    
      const departamento = await db.query("SELECT nombre FROM departamentos WHERE id_departamento = $1", [id_departamento]);
      console.log(res.locals.user);
      res.render("perfil.ejs", {departamento: departamento.rows[0]});
    } else {
      res.redirect("/login");
    }
  });

  app.get("/usuarios", async (req, res) => {

    if (req.isAuthenticated()) {
      const usuarios = await db.query("SELECT * FROM usuarios");
      res.render("usuarios.ejs", {usuarios: usuarios.rows});
    } else {
      res.redirect("/login");
    }
    
  })


  app.get("/edificios", async (req, res) => {
    if (req.isAuthenticated()) {
        const usuario = res.locals.user;
        const id_departamento = usuario.id_departamento;
        
        const departamento = await db.query("SELECT nombre FROM departamentos WHERE id_departamento = $1", [id_departamento]);
        const edificios = await db.query("SELECT * FROM edificios WHERE id_departamento = $1 ORDER BY nombre ASC", [id_departamento]);
        
        // Cambiar a tipos_elemento
        const tipos = await db.query("SELECT * FROM tipos_elemento");

        const id_encargado = req.body.id_encargado;
        const encargado = (await db.query("SELECT nombre FROM encargados WHERE id_encargado = $1", [id_encargado])).rows[0];

        // Inicializa la variable tipoSeleccionado
        const tipoSeleccionado = req.query.tipo || null; 
        const localidadesPorEdificio = {};

        for (const edificio of edificios.rows) {
            const localidades = await db.query(`
                SELECT localidades.*, tipos.nombre AS nombre_tipo, encargados.nombre AS nombre_encargado 
                FROM localidades 
                JOIN tipos ON localidades.id_tipo = tipos.id_tipo 
                LEFT JOIN encargados ON localidades.id_encargado = encargados.id_encargado 
                WHERE id_edificio = $1 ${tipoSeleccionado ? 'AND tipos.id_tipo = $2' : ''}
                ORDER BY localidades.nombre ASC
            `, tipoSeleccionado ? [edificio.id_edificio, tipoSeleccionado] : [edificio.id_edificio]);

            // Obtener componentes para cada localidad
            for (const localidad of localidades.rows) {
                const componentes = await db.query(`
                    SELECT * FROM elementos 
                    WHERE id_localidad = $1 
                    ORDER BY nombre ASC
                `, [localidad.id_localidad]);

                localidad.componentes = componentes.rows; // Agregar los componentes a la localidad
            }

            localidadesPorEdificio[edificio.id_edificio] = localidades.rows;
        }

        res.render("edificios.ejs", { 
            departamento: departamento.rows[0], 
            id_departamento: id_departamento, 
            edificios: edificios.rows, 
            tipos: tipos.rows, 
            localidadesPorEdificio: localidadesPorEdificio, 
            encargado: encargado,
            tipoSeleccionado,
        });
    } else {
        res.redirect("/login");
    }
});
  // EDIFICIOS


  app.post("/agregarEdificio", async (req, res) => {
    if (req.isAuthenticated()){
    const usuario = res.locals.user;
    const id_departamento = usuario.id_departamento;
    const nombre_edificio = req.body.edificio;

    await db.query("INSERT INTO edificios(nombre, id_departamento) VALUES($1, $2)", [nombre_edificio, id_departamento]);
    res.redirect("/edificios");

    } else {
      res.redirect("/login");
    }
  });


  // LOCALIDADES

 app.post("/agregarLocalidad", async (req, res) => {
  if (req.isAuthenticated()) {
    try {
      const nombreLocalidad = req.body.nuevaLocalidad;
      const tipo = req.body.tipo;
      const id_edificio = req.body.id_edificio;
      const encargado = req.body.encargadoLocalidad;

      const usuario = res.locals.user;
      const id_departamento = usuario.id_departamento;

      // Consultar todos los edificios del departamento del usuario
      const edificios = await db.query("SELECT * FROM edificios WHERE id_departamento = $1", [id_departamento]);

      // Consultar todos los tipos
      const tipos = await db.query("SELECT * FROM tipos");

      // Insertar la nueva localidad en la base de datos
      const encargadoInsert = await db.query("INSERT INTO encargados(nombre) VALUES($1) RETURNING id_encargado", [encargado])
      const id_encargado = encargadoInsert.rows[0].id_encargado;
      await db.query("INSERT INTO localidades(nombre, id_tipo, id_edificio, id_encargado) VALUES($1, $2, $3, $4)", [nombreLocalidad, tipo, id_edificio, id_encargado]);

      // Consultar todas las localidades agrupadas por edificio
      const localidades = await db.query("SELECT * FROM localidades WHERE id_edificio IN (SELECT id_edificio FROM edificios WHERE id_departamento = $1)", [id_departamento]);

      // Agrupar localidades por edificio
      const localidadesPorEdificio = localidades.rows.reduce((acc, localidad) => {
        if (!acc[localidad.id_edificio]) {
          acc[localidad.id_edificio] = [];
        }
        acc[localidad.id_edificio].push(localidad);
        return acc;
      }, {});

      // Renderizar la vista con todas las localidades agrupadas por edificio
      res.redirect("/edificios");
    } catch (err) {
      console.error(err);
      res.status(500).send('Error al procesar la solicitud');
    }
  } else {
    // Redirige al usuario a la página de login si no está autenticado
    res.redirect("/login");
  }
});


app.post("/agregarComponentes", async (req, res) => {
  const { id_localidad, id_tipo, modelo, marca, procesador, ram, sistema_operativo, tipo_disco, espacio_disco, tarjeta_grafica, fecha_compra, fecha_garantia, direccion_ip, numero_serie, resolucion, tipo_tinta, nombre_servidor, puertos } = req.body;

  try {
      // Verifica que los datos sean correctos
      console.log("Datos recibidos:", req.body);

      // Paso 1: Obtener el nombre del tipo de elemento basado en el `id_tipo`
      const tipoResult = await db.query(
          "SELECT nombre FROM tipos_elemento WHERE id_tipo = $1",
          [id_tipo]
      );

      if (tipoResult.rows.length === 0) {
          throw new Error("Tipo de elemento no encontrado");
      }

      const nombreTipo = tipoResult.rows[0].nombre;

      // Paso 2: Insertar el nuevo elemento en la tabla `elementos`, usando el `nombreTipo` como `nombre`
      const elementoResult = await db.query(
          "INSERT INTO elementos (nombre, id_tipo, id_localidad) VALUES ($1, $2, $3) RETURNING id_elemento",
          [nombreTipo, id_tipo, id_localidad]
      );
      const id_elemento = elementoResult.rows[0].id_elemento;

      // Paso 3: Insertar en la tabla específica según el tipo de elemento
      switch (parseInt(id_tipo)) {
          case 1: // Computadora
              await db.query(
                  "INSERT INTO computadoras (id_elemento, modelo, marca, procesador, ram, sistema_operativo, tipo_disco, espacio_disco, tarjeta_grafica, fecha_compra, fecha_garantia) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)",
                  [id_elemento, modelo, marca, procesador, ram, sistema_operativo, tipo_disco, espacio_disco, tarjeta_grafica, fecha_compra, fecha_garantia]
              );
              break;

          case 3: // Proyector
              await db.query(
                  "INSERT INTO proyectores (id_elemento, marca, fecha_compra, fecha_garantia, modelo, resolucion) VALUES ($1, $2, $3, $4, $5, $6)",
                  [id_elemento, marca, fecha_compra, fecha_garantia, modelo, resolucion]
              );
              break;

          case 2: // Impresora
              await db.query(
                  "INSERT INTO impresoras (id_elemento, modelo, marca, fecha_compra, fecha_garantia, tipo_tinta) VALUES ($1, $2, $3, $4, $5, $6)",
                  [id_elemento, modelo, marca, fecha_compra, fecha_garantia, tipo_tinta]
              );
              break;

          case 6: // Access Point
              await db.query(
                  "INSERT INTO access_points (id_elemento, direccion_ip, marca, modelo, numero_serie, fecha_compra, fecha_garantia) VALUES ($1, $2, $3, $4, $5, $6, $7)",
                  [id_elemento, direccion_ip, marca, modelo, numero_serie, fecha_compra, fecha_garantia]
              );
              break;

          case 4: // Switch
              await db.query(
                  "INSERT INTO switches (id_elemento, marca, fecha_compra, fecha_garantia, puertos, numero_serie, modelo) VALUES ($1, $2, $3, $4, $5, $6, $7)",
                  [id_elemento, marca, fecha_compra, fecha_garantia, puertos, numero_serie, modelo]
              );
              break;

          case 5: // Servidor
              await db.query(
                  "INSERT INTO servidores (id_elemento, fecha_compra, fecha_garantia, nombre_servidor, marca, modelo) VALUES ($1, $2, $3, $4, $5, $6)",
                  [id_elemento, fecha_compra, fecha_garantia, nombre_servidor, marca, modelo]
              );
              break;

          default:
              console.log("Tipo de elemento no reconocido.");
              res.status(400).send("Tipo de elemento no reconocido.");
              return;
      }

      res.send(`
        <script>
            alert("Componente agregado exitosamente.");
            window.close();
        </script>
    `);
} catch (error) {
    console.error("Error al agregar componente:", error);
    res.status(500).send(`
        <script>
            alert("Error al agregar componente.");
            window.close();
        </script>
    `);
}
});



// USUARIOS

app.get("/usuarios", async (req, res) => {

  const consulta = await db.query("SELECT * FROM usuarios");
  const usuarios = consulta.rows;

  res.render("usuario.ejs", {usuarios: usuarios});

})


  passport.serializeUser((user, cb) => {
    cb(null, user);
  });
  
  passport.deserializeUser((user, cb) => {
    cb(null, user);
  });
  
  


app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
  

