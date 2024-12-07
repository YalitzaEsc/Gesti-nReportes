import express from "express";
import bodyParser from "body-parser";
import pg from "pg";
import bcrypt from "bcrypt";
import session from "express-session";
import passport from "passport";
import {Strategy} from "passport-local";
import env from "dotenv";


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
    if (req.user.nombre_usuario === 'Jefe') {
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

app.get('/vistaIncidencias', async (req, res) => {
  const usuario = res.locals.user;
  const nombre_usuario = usuario.nombre + " " + usuario.apellidos;
  const id_departamento = usuario.id_departamento;
  const id_elemento = req.query.id_elemento;
  const departamento = await db.query("SELECT nombre FROM departamentos WHERE id_departamento = $1", [id_departamento]);
  const id_localidad = await db.query("SELECT id_localidad FROM elementos WHERE id_elemento = $1", [id_elemento]);
  const localidad = await db.query("SELECT nombre FROM localidades WHERE id_localidad = $1", [id_localidad.rows[0].id_localidad]);
  const id_encargado = await db.query("SELECT id_encargado FROM localidades WHERE id_localidad = $1", [id_localidad.rows[0].id_localidad]);
  const encargado = await db.query("SELECT nombre FROM encargados WHERE id_encargado = $1", [id_encargado.rows[0].id_encargado]);
  const edificio = await db.query("SELECT id_edificio FROM localidades WHERE id_localidad = $1", [id_localidad.rows[0].id_localidad]);
  const nombre_edificio = await db.query("SELECT nombre FROM edificios WHERE id_edificio = $1", [edificio.rows[0].id_edificio]);
  const componente = await db.query("SELECT * FROM elementos WHERE id_elemento = $1", [id_elemento]);

  res.render('vistaIncidencias', {
    nombre_usuario: encargado.rows[0].nombre,
    id_encargado: id_encargado.rows[0].id_encargado,
    departamento: departamento.rows[0], 
    id_departamento: id_departamento,
    id_elemento: id_elemento,
    localidad: localidad.rows[0],
    edificio: nombre_edificio.rows[0],
    componente: componente.rows[0]});
});

app.post('/agregarIncidencia', async (req, res) => {
  const { id_elemento, id_encargado, descripcion, id_departamento} = req.body;

  console.log(id_elemento, id_encargado, descripcion, id_departamento);
  await db.query("INSERT INTO incidentes(id_elemento, id_encargado, descripcion, id_departamento) VALUES($1, $2, $3, $4)", [id_elemento, id_encargado, descripcion, id_departamento]);

  res.send(`
    <script>
        alert("Incidencia enviada exitosamente.");
        window.close();
    </script>
`);
  
});

app.get('/incidencias', async (req, res) => {
  if (req.isAuthenticated()) {
    try {
      const usuario = res.locals.user;
      const id_departamento = usuario.id_departamento;
      const { estado } = req.query;

      let query = `
        SELECT i.id_incidente, i.descripcion, i.estado, i.fecha_creacion, i.fecha_resolucion, i.resolucion,
               e.nombre AS nombre_elemento, e.codigo, 
               l.nombre AS nombre_localidad,
               d.nombre AS nombre_departamento,
               ed.nombre AS nombre_edificio,
               enc.nombre AS nombre_encargado,
               u.nombre AS nombre_tecnico,
               s.nombre AS nombre_servicio,   -- Obtener el servicio
               i.clasificacion,               -- Obtener clasificación
               -- Formatear la hora estimada de finalización (12h sin fecha)
               TO_CHAR(i.fecha_creacion + INTERVAL '1 hour' * s.tiempo_estimado, 'HH12:MI:SS AM') AS hora_estimada,
               -- Formatear la hora de resolución (12h sin fecha)
               TO_CHAR(i.fecha_resolucion, 'HH12:MI:SS AM') AS hora_resolucion,
               (SELECT COUNT(*) FROM calificaciones c WHERE c.id_incidente = i.id_incidente) AS tiene_calificacion
        FROM incidentes i
        JOIN elementos e ON i.id_elemento = e.id_elemento
        LEFT JOIN localidades l ON e.id_localidad = l.id_localidad
        LEFT JOIN edificios ed ON l.id_edificio = ed.id_edificio
        LEFT JOIN departamentos d ON i.id_departamento = d.id_departamento
        LEFT JOIN encargados enc ON l.id_encargado = enc.id_encargado
        LEFT JOIN usuarios u ON i.id_tecnico = u.id_usuario
        LEFT JOIN servicios s ON i.id_servicio = s.id_servicio  -- Unir con la tabla de servicios
        WHERE i.id_departamento = $1
      `;

      const params = [id_departamento];
      if (estado) {
        query += ` AND i.estado = $2`;
        params.push(estado);
      }

      query += ` ORDER BY i.fecha_creacion DESC`;

      const incidentes = await db.query(query, params);

      res.render('incidencias', { incidentes: incidentes.rows, estadoSeleccionado: estado });
    } catch (error) {
      console.error('Error al obtener los incidentes:', error);
      res.status(500).send('Error al obtener los incidentes');
    }
  } else {
    res.redirect('/login');
  }
});

app.get('/administrarIncidencias', async (req, res) => {
  if (req.isAuthenticated()) {
    try {
      const { estado } = req.query;

      // Crear la consulta base con un LEFT JOIN para obtener el costo de la solicitud de cambio si el estado es "En autorización"
      let query = `
      SELECT i.id_incidente, i.descripcion, i.estado, i.fecha_creacion, i.fecha_resolucion, i.resolucion,
             e.nombre AS nombre_elemento, e.codigo, 
             l.nombre AS nombre_localidad,
             d.nombre AS nombre_departamento,
             u.nombre AS nombre_tecnico,
             enc.nombre AS nombre_encargado,
             edif.nombre AS nombre_edificio,
             sc.costo,
             s.nombre AS nombre_servicio,   -- Agregar servicio
             i.clasificacion,               -- Obtener clasificación
             -- Formatear la hora estimada de finalización (12h sin fecha)
             TO_CHAR(i.fecha_creacion + INTERVAL '1 hour' * s.tiempo_estimado, 'HH12:MI:SS AM') AS hora_estimada,
             -- Formatear la hora de resolución (12h sin fecha)
             TO_CHAR(i.fecha_resolucion, 'HH12:MI:SS AM') AS hora_resolucion
      FROM incidentes i
      JOIN elementos e ON i.id_elemento = e.id_elemento
      LEFT JOIN localidades l ON e.id_localidad = l.id_localidad
      LEFT JOIN departamentos d ON i.id_departamento = d.id_departamento
      LEFT JOIN usuarios u ON i.id_tecnico = u.id_usuario
      LEFT JOIN encargados enc ON l.id_encargado = enc.id_encargado
      LEFT JOIN edificios edif ON l.id_edificio = edif.id_edificio
      LEFT JOIN solicitudes_cambio sc ON i.id_incidente = sc.id_incidente AND i.estado = 'En autorización'
      LEFT JOIN servicios s ON i.id_servicio = s.id_servicio  -- Unir con la tabla de servicios
    `;

      // Aplicar filtro de estado si está presente
      const params = [];
      if (estado) {
        query += ` WHERE i.estado = $1`;
        params.push(estado);
      }

      query += ` ORDER BY i.fecha_creacion DESC`;

      // Ejecutar la consulta
      const incidentes = await db.query(query, params);

      // Renderizar la vista con los incidentes filtrados y el estado seleccionado
      res.render('administrarIncidencias', { incidentes: incidentes.rows, estadoSeleccionado: estado });
    } catch (error) {
      console.error('Error al obtener los incidentes:', error);
      res.status(500).send('Error al obtener los incidentes');
    }
  } else {
    res.redirect('/login');
  }
});



app.get('/asignar', async (req, res) => {
  if (req.isAuthenticated()) {
      try {
          const { id_incidente } = req.query;

          // Obtener la lista de técnicos
          const tecnicos_software = await db.query("SELECT id_usuario, nombre FROM usuarios WHERE puesto = 'Tecnico en Software'");
          const tecnicos_hardware = await db.query("SELECT id_usuario, nombre FROM usuarios WHERE puesto = 'Tecnico en Hardware'");
          
          // Obtener el catálogo de servicios
          const servicios = await db.query("SELECT id_servicio, nombre FROM servicios");

          res.render('asignar', {
              id_incidente,
              tecnicos_software: tecnicos_software.rows,
              tecnicos_hardware: tecnicos_hardware.rows,
              servicios: servicios.rows // Pasar los servicios a la vista
          });
             
      } catch (error) {
          console.error('Error al cargar la vista de asignación:', error);
          res.status(500).send('Error al cargar la vista de asignación');
      }
  } else {
      res.redirect('/login');
  }
});


app.get('/incidencias-activas', async (req, res) => {
  if (req.isAuthenticated()) {
      try {
          const { id_tecnico } = req.query;

          // Contar incidencias activas del técnico (excluyendo "Terminado" y "Liberado")
          const result = await db.query(
              `SELECT COUNT(*) FROM incidentes 
               WHERE id_tecnico = $1 
               AND estado NOT IN ('Terminado', 'Liberado')`,
              [id_tecnico]
          );

          const incidenciasActivas = result.rows[0].count;

          res.json({ incidenciasActivas });
      } catch (error) {
          console.error('Error al contar las incidencias activas:', error);
          res.status(500).send('Error al contar las incidencias activas');
      }
  } else {
      res.redirect('/login');
  }
});


app.post('/asignarIncidente', async (req, res) => {
  const { id_incidente, tecnico, clasificacion, servicio, prioridad } = req.body;

  try {
      // Actualizar el técnico asignado al incidente
      await db.query(
        "UPDATE incidentes SET id_tecnico = $1, estado = 'En proceso', clasificacion = $2, prioridad = $3, id_servicio = $4 WHERE id_incidente = $5",
        [tecnico, clasificacion, prioridad, servicio, id_incidente]
      );

      // Enviar un mensaje de éxito y cerrar el modal
      res.send(`
          <script>
              alert("Técnico asignado exitosamente.");
              window.close();
          </script>
      `);
  } catch (error) {
      console.error('Error al asignar técnico:', error);
      res.status(500).send('Error al asignar técnico');
  }
});

app.post('/liberarIncidencia', async (req, res) => {
  const { id_incidente } = req.body; // Captura desde el cuerpo del formulario
  try {
      await db.query("UPDATE incidentes SET estado = 'Liberado' WHERE id_incidente = $1", [id_incidente]);
      res.redirect('/incidencias');
  } catch (error) {
      console.error('Error al liberar incidente:', error);
      res.status(500).send('Error al liberar incidente');
  }
});

// ÓRDENES DE TRABAJO

app.get('/orden-trabajo', async (req, res) => {
  const usuario = res.locals.user;
  const id_usuario = usuario.id_usuario;

  if (req.isAuthenticated()) {
      try {
          const { estado, prioridad } = req.query;

          let query = `
              SELECT i.id_incidente, i.descripcion, i.estado, i.fecha_creacion, i.fecha_resolucion, i.resolucion, i.clasificacion, i.prioridad,
                     e.nombre AS nombre_elemento, e.codigo, 
                     l.nombre AS nombre_localidad,
                     d.nombre AS nombre_departamento,
                     u.nombre AS nombre_tecnico,
                     enc.nombre AS nombre_encargado,
                     edif.nombre AS nombre_edificio,
                     i.clasificacion, i.prioridad,
                     s.nombre AS nombre_servicio,  -- Aquí agregamos el nombre del servicio
                     s.tiempo_estimado
              FROM incidentes i
              JOIN elementos e ON i.id_elemento = e.id_elemento
              LEFT JOIN localidades l ON e.id_localidad = l.id_localidad
              LEFT JOIN departamentos d ON i.id_departamento = d.id_departamento
              LEFT JOIN usuarios u ON i.id_tecnico = u.id_usuario
              LEFT JOIN encargados enc ON l.id_encargado = enc.id_encargado
              LEFT JOIN edificios edif ON l.id_edificio = edif.id_edificio
              LEFT JOIN servicios s ON i.id_servicio = s.id_servicio  -- Unimos con la tabla servicios
              WHERE i.id_tecnico = $1
          `;

          const params = [id_usuario];
          
          if (estado) {
              query += ` AND i.estado = $${params.length + 1}`;
              params.push(estado);
          }
          
          if (prioridad) {
              query += ` AND i.prioridad = $${params.length + 1}`;
              params.push(prioridad);
          }

          query += ` ORDER BY i.fecha_creacion DESC`;

          const incidentes = await db.query(query, params);

          // Función para formatear horas en formato hh:mm:ss AM/PM
          const formatAMPM = (date) => {
              let hours = date.getHours();
              const minutes = date.getMinutes().toString().padStart(2, '0');
              const seconds = date.getSeconds().toString().padStart(2, '0');
              const ampm = hours >= 12 ? 'PM' : 'AM';
              hours = hours % 12;
              hours = hours ? hours : 12; // La hora "0" se convierte en 12
              return `${hours}:${minutes}:${seconds} ${ampm}`;
          };

          // Calcular la fecha estimada de finalización y extraer solo las horas con AM/PM
          incidentes.rows.forEach(incidente => {
              const fechaCreacion = new Date(incidente.fecha_creacion);
              const tiempoEstimado = incidente.tiempo_estimado || 0; // En horas

              // Sumar las horas al tiempo de creación
              fechaCreacion.setHours(fechaCreacion.getHours() + tiempoEstimado);

              // Formatear la fecha estimada solo con hora (AM/PM)
              incidente.hora_estimada = formatAMPM(fechaCreacion);

              // Si existe fecha de resolución, formatearla de igual manera
              if (incidente.fecha_resolucion) {
                  const fechaResolucion = new Date(incidente.fecha_resolucion);
                  incidente.hora_resolucion = formatAMPM(fechaResolucion);
              }
          });

          // Renderizar la vista pasando los datos con la hora estimada y de resolución
          res.render('orden-trabajo', { 
              incidentes: incidentes.rows,
              estadoSeleccionado: estado,
              prioridadSeleccionada: prioridad 
          });
      } catch (error) {
          console.error('Error al obtener los incidentes:', error);
          res.status(500).send('Error al obtener los incidentes');
      }
  } else {
      res.redirect('/login');
  }
});

app.get('/terminarIncidente', async (req, res) => {
  if(req.isAuthenticated()){
    try {
      const id_incidente = req.query.id_incidente;

      // Consulta para obtener todos los detalles del incidente y el elemento reportado
      const incidenteQuery = `
    SELECT i.id_incidente, i.descripcion, i.estado, i.fecha_creacion, i.fecha_resolucion, i.resolucion,
           e.nombre AS nombre_elemento, e.codigo, 
           l.nombre AS nombre_localidad,
           d.nombre AS nombre_departamento,
           u.nombre AS nombre_tecnico,
           enc.nombre AS nombre_encargado,
           edif.nombre AS nombre_edificio,
           
           -- Campos para detalles de computadoras
           comp.modelo AS modelo_computadora, comp.marca AS marca_computadora, comp.ram AS ram_computadora,
           comp.procesador AS procesador_computadora, comp.sistema_operativo AS so_computadora,
           comp.tipo_disco AS tipo_disco_computadora, comp.espacio_disco AS espacio_disco_computadora,
           comp.tarjeta_grafica AS tarjeta_grafica_computadora, comp.fecha_compra AS fecha_compra_computadora,
           comp.fecha_garantia AS fecha_garantia_computadora,

           -- Campos para detalles de impresoras
           imp.modelo AS modelo_impresora, imp.tipo_tinta AS tinta_impresora,
           imp.marca AS marca_impresora, imp.fecha_compra AS fecha_compra_impresora,
           imp.fecha_garantia AS fecha_garantia_impresora,

           -- Campos para detalles de proyectores
           proy.marca AS marca_proyector, proy.fecha_compra AS fecha_compra_proyector,
           proy.fecha_garantia AS fecha_garantia_proyector, proy.modelo AS modelo_proyector,
           proy.resolucion AS resolucion_proyector,

           -- Campos para detalles de access points
           access.direccion_ip AS direccion_ip_access, access.marca AS marca_access,
           access.modelo AS modelo_access, access.numero_serie AS numero_serie_access,
           access.fecha_compra AS fecha_compra_access, access.fecha_garantia AS fecha_garantia_access,

           -- Campos para detalles de servidores
           serv.nombre_servidor AS nombre_servidor_servidor, serv.fecha_compra AS fecha_compra_servidor,
           serv.fecha_garantia AS fecha_garantia_servidor, serv.marca AS marca_servidor,
           serv.modelo AS modelo_servidor,

           -- Campos para detalles de switches
           sw.marca AS marca_switch, sw.fecha_compra AS fecha_compra_switch,
           sw.fecha_garantia AS fecha_garantia_switch, sw.puertos AS puertos_switch,
           sw.numero_serie AS numero_serie_switch, sw.modelo AS modelo_switch
           
    FROM incidentes i
    JOIN elementos e ON i.id_elemento = e.id_elemento
    LEFT JOIN localidades l ON e.id_localidad = l.id_localidad
    LEFT JOIN departamentos d ON i.id_departamento = d.id_departamento
    LEFT JOIN usuarios u ON i.id_tecnico = u.id_usuario
    LEFT JOIN encargados enc ON l.id_encargado = enc.id_encargado
    LEFT JOIN edificios edif ON l.id_edificio = edif.id_edificio

    -- Uniones adicionales para cada tipo de elemento
    LEFT JOIN computadoras comp ON e.id_elemento = comp.id_elemento
    LEFT JOIN impresoras imp ON e.id_elemento = imp.id_elemento
    LEFT JOIN proyectores proy ON e.id_elemento = proy.id_elemento
    LEFT JOIN access_points access ON e.id_elemento = access.id_elemento
    LEFT JOIN servidores serv ON e.id_elemento = serv.id_elemento
    LEFT JOIN switches sw ON e.id_elemento = sw.id_elemento

    WHERE i.id_incidente = $1
`;

      const incidenteResult = await db.query(incidenteQuery, [id_incidente]);

      if (incidenteResult.rows.length === 0) {
        return res.status(404).send("Incidente no encontrado");
      }

      res.render('terminarIncidente', { incidente: incidenteResult.rows[0] });
    } catch (error) {
      console.error('Error al cargar la vista de terminar incidente:', error);
      res.status(500).send('Error al cargar la vista de terminar incidente');
    }
  } else {
    res.redirect('/login');
  }
});

app.post('/resolucion', async (req, res) => {
  const { id_incidente, id_elemento, resolucion, piezaSolicitada, costo } = req.body;
  const solicitarCambio = req.body.solicitarCambio === 'true'; // Verifica si se envió como "true"

  try {
      if (solicitarCambio && piezaSolicitada && costo) {
          const costoNumerico = parseFloat(costo) || 0;

          // Cambiar el estado del incidente y establecer solicitud_cambio en true
          await db.query(
              "UPDATE incidentes SET estado = 'En autorización', resolucion = $1, solicitud_cambio = true WHERE id_incidente = $2",
              [resolucion, id_incidente]
          );

          // Insertar la solicitud de cambio en solicitudes_cambio
          await db.query(
              `INSERT INTO solicitudes_cambio (id_incidente, pieza_solicitada, costo)
               VALUES ($1, $2, $3)`,
              [
                  parseInt(id_incidente),
                  piezaSolicitada,
                  costoNumerico
              ]
          );
      } else {
          await db.query(
              "UPDATE incidentes SET estado = 'Terminado', resolucion = $1 WHERE id_incidente = $2",
              [resolucion, id_incidente]
          );
      }

      res.send(`
          <script>
              alert("Incidente concluido exitosamente.");
              window.close();
          </script>
      `);
  } catch (error) {
      console.error('Error al resolver incidente:', error);
      res.status(500).send('Error al resolver incidente');
  }
});

app.get('/confirmarCambio', async (req, res) => {
  const id_incidente = req.query.id_incidente;

  if (!id_incidente) {
      return res.status(400).send("ID de incidente no proporcionado");
  }

  try {
      // Consultar detalles del incidente usando `id_incidente`
      const incidenteResult = await db.query("SELECT * FROM incidentes WHERE id_incidente = $1", [id_incidente]);

      if (incidenteResult.rows.length === 0) {
          return res.status(404).send("Incidente no encontrado");
      }

      res.render('confirmarCambio', { incidente: incidenteResult.rows[0] });
  } catch (error) {
      console.error('Error al cargar confirmarCambio:', error);
      res.status(500).send('Error al cargar confirmarCambio');
  }
});

app.post('/confirmarCambio', async (req, res) => {
  console.log("Datos recibidos:", req.body); // Asegúrate de ver id_incidente correctamente

  const { id_incidente, cambio, resolucion } = req.body;

  try {
      // Actualización en la tabla solicitudes_cambio
      await db.query(
          "UPDATE solicitudes_cambio SET cambio = $1 WHERE id_incidente = $2",
          [cambio === 'exitoso' ? 'Exitoso' : 'Fallido', id_incidente]
      );

      // Actualización en la tabla incidentes
      await db.query(
          "UPDATE incidentes SET estado = 'Terminado', resolucion = $1 WHERE id_incidente = $2",
          [resolucion, id_incidente]
      );

      res.send(`
          <script>
              alert("Cambio confirmado exitosamente.");
              window.close();
          </script>
      `);
  } catch (error) {
      console.error('Error al confirmar cambio:', error);
      res.status(500).send('Error al confirmar cambio');
  }
});



app.get('/solicitudes', async (req, res) => {
  if (req.isAuthenticated()) {
    try {
      const query = `
        SELECT 
          i.id_incidente, i.descripcion AS descripcion_incidencia, i.fecha_creacion, i.estado, 
          e.nombre AS nombre_elemento, e.codigo, l.nombre AS nombre_localidad,
          d.nombre AS nombre_departamento, edif.nombre AS nombre_edificio, 
          u.nombre AS nombre_tecnico, enc.nombre AS nombre_encargado,
          sc.id_solicitud, sc.pieza_solicitada, sc.costo
        FROM solicitudes_cambio sc
        JOIN incidentes i ON sc.id_incidente = i.id_incidente
        JOIN elementos e ON i.id_elemento = e.id_elemento
        LEFT JOIN localidades l ON e.id_localidad = l.id_localidad
        LEFT JOIN departamentos d ON i.id_departamento = d.id_departamento
        LEFT JOIN usuarios u ON i.id_tecnico = u.id_usuario
        LEFT JOIN encargados enc ON l.id_encargado = enc.id_encargado
        LEFT JOIN edificios edif ON l.id_edificio = edif.id_edificio
        WHERE sc.costo > 1000 AND i.solicitud_cambio = true AND i.estado = 'En autorización'
        ORDER BY i.fecha_creacion DESC;
      `;

      const solicitudes = await db.query(query);

      res.render('solicitudes', { solicitudes: solicitudes.rows });

    } catch (error) {
      console.error('Error al cargar la vista de solicitudes:', error);
    }
  } else {
    res.redirect('/login');
  }
});


app.get('/calificar', async (req, res) => {

  const id_incidente = req.query.id_incidente;
  const incidente = await db.query("SELECT * FROM incidentes WHERE id_incidente = $1", [id_incidente]);
  const id_tecnico = await db.query("SELECT id_tecnico FROM incidentes WHERE id_incidente = $1", [id_incidente]);
  const nombre_tecnico = await db.query("SELECT nombre FROM usuarios WHERE id_usuario = $1", [id_tecnico.rows[0].id_tecnico]);

  res.render('calificar', { incidente: incidente.rows[0], 
    nombre_tecnico: nombre_tecnico.rows[0].nombre });
});

app.post('/calificar', async (req, res) => {
  const { id_incidente, id_tecnico, calificacion, termino_en_tiempo, comentarios } = req.body;

  try {
      // Insertar la calificación y los nuevos campos en la tabla `calificaciones`
      await db.query(
          `INSERT INTO calificaciones (id_tecnico, id_incidente, calificacion, puntual, comentarios)
           VALUES ($1, $2, $3, $4, $5)`,
          [id_tecnico, id_incidente, calificacion, termino_en_tiempo, comentarios]
      );

      res.send(`
          <script>
              alert("Calificación registrada exitosamente.");
              window.close();
          </script>
      `);
  } catch (error) {
      console.error('Error al guardar la calificación:', error);
      res.status(500).send('Error al guardar la calificación');
  }
});

app.get('/calificaciones', async (req, res) => {
  if (req.isAuthenticated()) {
    try {
      const query = `
        SELECT 
          calificaciones.id_calificacion,
          calificaciones.id_incidente,
          usuarios.nombre AS nombre_tecnico,
          encargados.nombre AS nombre_encargado,
          calificaciones.calificacion,
          calificaciones.puntual,
          calificaciones.comentarios
        FROM 
          calificaciones
        JOIN 
          incidentes ON calificaciones.id_incidente = incidentes.id_incidente
        LEFT JOIN 
          usuarios ON calificaciones.id_tecnico = usuarios.id_usuario
        LEFT JOIN 
          encargados ON incidentes.id_encargado = encargados.id_encargado;
      `;
      
      const calificaciones = await db
        .query(query)
        .then((result) => result.rows);

      res.render('calificaciones', { calificaciones });
    } catch (error) {
      console.error('Error al cargar la vista de calificaciones:', error);
      res.status(500).send('Error al cargar la vista de calificaciones');
    }
  } else {
    res.redirect('/login');
  }
});



app.get("/edificiosVista", async (req, res) => {
  if (req.isAuthenticated()) {
      try {
          const searchQuery = req.query.search || '';
          const selectedDepartamento = req.query.departamento || null;

          // Obtener todos los departamentos excepto "Acceso General"
          const departamentos = await db.query("SELECT * FROM departamentos WHERE nombre != 'Acceso General' ORDER BY nombre ASC");

          let edificiosPorDepartamento = {};

          if (selectedDepartamento) {
              // Obtener edificios y localidades solo para el departamento seleccionado
              const edificios = await db.query(`
                  SELECT * 
                  FROM edificios 
                  WHERE id_departamento = $1 
                  AND (nombre ILIKE $2 OR EXISTS (
                      SELECT 1 FROM localidades 
                      WHERE localidades.id_edificio = edificios.id_edificio 
                      AND (localidades.nombre ILIKE $2 OR EXISTS (
                          SELECT 1 FROM elementos 
                          WHERE elementos.id_localidad = localidades.id_localidad 
                          AND elementos.nombre ILIKE $2
                      ))
                  ))
                  ORDER BY nombre ASC
              `, [selectedDepartamento, `%${searchQuery}%`]);

              const localidadesPorEdificio = {};

              for (const edificio of edificios.rows) {
                  const localidades = await db.query(`
                      SELECT localidades.*, tipos.nombre AS nombre_tipo, encargados.nombre AS nombre_encargado 
                      FROM localidades 
                      JOIN tipos ON localidades.id_tipo = tipos.id_tipo 
                      LEFT JOIN encargados ON localidades.id_encargado = encargados.id_encargado 
                      WHERE id_edificio = $1
                      ORDER BY localidades.nombre ASC
                  `, [edificio.id_edificio]);

                  for (const localidad of localidades.rows) {
                      const componentes = await db.query(`
                          SELECT * FROM elementos 
                          WHERE id_localidad = $1 
                          ORDER BY nombre ASC
                      `, [localidad.id_localidad]);

                      localidad.componentes = componentes.rows;
                  }

                  localidadesPorEdificio[edificio.id_edificio] = localidades.rows;
              }

              edificiosPorDepartamento[departamentos.rows.find(dep => dep.id_departamento == selectedDepartamento).nombre] = {
                  edificios: edificios.rows,
                  localidadesPorEdificio: localidadesPorEdificio
              };
          }

          res.render("edificiosVista.ejs", { 
              departamentos: departamentos.rows,
              edificiosPorDepartamento,
              selectedDepartamento,
              searchQuery
          });
      } catch (error) {
          console.error("Error al cargar la vista de edificios:", error);
          res.status(500).send("Error al cargar la vista de edificios");
      }
  } else {
      res.redirect("/login");
  }
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

app.get('/autorizacionCambio', async (req, res) => {
    if(req.isAuthenticated()){
      try {
        const id_incidente = req.query.id_incidente;
        console.log(id_incidente);
  
        // Consulta para obtener todos los detalles del incidente y el elemento reportado
        const incidenteQuery = `
      SELECT i.id_incidente, i.descripcion, i.estado, i.fecha_creacion, i.fecha_resolucion, i.resolucion,
             e.nombre AS nombre_elemento, e.codigo, 
             l.nombre AS nombre_localidad,
             d.nombre AS nombre_departamento,
             u.nombre AS nombre_tecnico,
             enc.nombre AS nombre_encargado,
             edif.nombre AS nombre_edificio,
             
             -- Campos para detalles de computadoras
             comp.modelo AS modelo_computadora, comp.marca AS marca_computadora, comp.ram AS ram_computadora,
             comp.procesador AS procesador_computadora, comp.sistema_operativo AS so_computadora,
             comp.tipo_disco AS tipo_disco_computadora, comp.espacio_disco AS espacio_disco_computadora,
             comp.tarjeta_grafica AS tarjeta_grafica_computadora, comp.fecha_compra AS fecha_compra_computadora,
             comp.fecha_garantia AS fecha_garantia_computadora,
  
             -- Campos para detalles de impresoras
             imp.modelo AS modelo_impresora, imp.tipo_tinta AS tinta_impresora,
             imp.marca AS marca_impresora, imp.fecha_compra AS fecha_compra_impresora,
             imp.fecha_garantia AS fecha_garantia_impresora,
  
             -- Campos para detalles de proyectores
             proy.marca AS marca_proyector, proy.fecha_compra AS fecha_compra_proyector,
             proy.fecha_garantia AS fecha_garantia_proyector, proy.modelo AS modelo_proyector,
             proy.resolucion AS resolucion_proyector,
  
             -- Campos para detalles de access points
             access.direccion_ip AS direccion_ip_access, access.marca AS marca_access,
             access.modelo AS modelo_access, access.numero_serie AS numero_serie_access,
             access.fecha_compra AS fecha_compra_access, access.fecha_garantia AS fecha_garantia_access,
  
             -- Campos para detalles de servidores
             serv.nombre_servidor AS nombre_servidor_servidor, serv.fecha_compra AS fecha_compra_servidor,
             serv.fecha_garantia AS fecha_garantia_servidor, serv.marca AS marca_servidor,
             serv.modelo AS modelo_servidor,
  
             -- Campos para detalles de switches
             sw.marca AS marca_switch, sw.fecha_compra AS fecha_compra_switch,
             sw.fecha_garantia AS fecha_garantia_switch, sw.puertos AS puertos_switch,
             sw.numero_serie AS numero_serie_switch, sw.modelo AS modelo_switch
             
      FROM incidentes i
      JOIN elementos e ON i.id_elemento = e.id_elemento
      LEFT JOIN localidades l ON e.id_localidad = l.id_localidad
      LEFT JOIN departamentos d ON i.id_departamento = d.id_departamento
      LEFT JOIN usuarios u ON i.id_tecnico = u.id_usuario
      LEFT JOIN encargados enc ON l.id_encargado = enc.id_encargado
      LEFT JOIN edificios edif ON l.id_edificio = edif.id_edificio
  
      -- Uniones adicionales para cada tipo de elemento
      LEFT JOIN computadoras comp ON e.id_elemento = comp.id_elemento
      LEFT JOIN impresoras imp ON e.id_elemento = imp.id_elemento
      LEFT JOIN proyectores proy ON e.id_elemento = proy.id_elemento
      LEFT JOIN access_points access ON e.id_elemento = access.id_elemento
      LEFT JOIN servidores serv ON e.id_elemento = serv.id_elemento
      LEFT JOIN switches sw ON e.id_elemento = sw.id_elemento
  
      WHERE i.id_incidente = $1
  `;

        const incidenteResult = await db.query(incidenteQuery, [id_incidente]);
  
        if (incidenteResult.rows.length === 0) {
          return res.status(404).send("Incidente no encontrado");
        }

        const solicitudCambio = await db.query("SELECT * FROM solicitudes_cambio WHERE id_incidente = $1", [id_incidente]);
  
        res.render('autorizacionCambio', { 
          incidente: incidenteResult.rows[0], 
          solicitudCambio: solicitudCambio.rows[0] });
      } catch (error) {
        console.error('Error al cargar la vista de autorización:', error);
        res.status(500).send('Error al cargar la vista de autorización');
      }
    } else {
      res.redirect('/login');
    }
  });



  app.post('/autorizarCambio', async (req, res) => {
    const { id_incidente, id_solicitud, accion, contexto } = req.body;

    try {
        if (accion === 'autorizar') {
            await db.query("UPDATE incidentes SET estado = 'Cambio' WHERE id_incidente = $1", [id_incidente]);
            await db.query("UPDATE solicitudes_cambio SET estado = 'Autorizado' WHERE id_solicitud = $1", [id_solicitud]);
        } else if (accion === 'rechazar') {
            await db.query("UPDATE incidentes SET estado = 'Rechazado' WHERE id_incidente = $1", [id_incidente]);
            await db.query("UPDATE solicitudes_cambio SET estado = 'Rechazado' WHERE id_solicitud = $1", [id_solicitud]);
        }

        if (contexto === 'modal') {
            res.send(`
                <script>
                    alert("${accion === 'autorizar' ? 'Cambio autorizado exitosamente.' : 'Cambio rechazado.'}");
                    window.close();
                </script>
            `);
        } else {
            // Enviar un mensaje de éxito al cliente
            res.redirect('/solicitudes');
        }

    } catch (error) {
        console.error('Error al procesar la autorización/rechazo:', error);
        res.status(500).send('Error al procesar la autorización/rechazo');
    }
});


app.get('/recuentoSolicitudes', async (req, res) => {

  if(req.isAuthenticated()){

    try {
      const query = `
        SELECT 
          i.id_incidente, i.descripcion AS descripcion_incidencia, i.fecha_creacion, i.estado, 
          e.nombre AS nombre_elemento, e.codigo, l.nombre AS nombre_localidad,
          d.nombre AS nombre_departamento, edif.nombre AS nombre_edificio, 
          u.nombre AS nombre_tecnico, enc.nombre AS nombre_encargado,
          sc.id_solicitud, sc.pieza_solicitada, sc.costo, sc.estado, sc.cambio
        FROM solicitudes_cambio sc
        JOIN incidentes i ON sc.id_incidente = i.id_incidente
        JOIN elementos e ON i.id_elemento = e.id_elemento
        LEFT JOIN localidades l ON e.id_localidad = l.id_localidad
        LEFT JOIN departamentos d ON i.id_departamento = d.id_departamento
        LEFT JOIN usuarios u ON i.id_tecnico = u.id_usuario
        LEFT JOIN encargados enc ON l.id_encargado = enc.id_encargado
        LEFT JOIN edificios edif ON l.id_edificio = edif.id_edificio
        WHERE i.solicitud_cambio = true 
        ORDER BY i.fecha_creacion DESC;
      `;

      const solicitudes = await db.query(query);
      res.render('recuentoSolicitudes', {solicitudes: solicitudes.rows});

    } catch (error) {
      console.error('Error al cargar la vista de solicitudes:', error);
    }

  }else {
    res.redirect('/login')
  }

});


app.get('/verIncidencia', async (req, res) => {
  const id_incidente = req.query.id_incidente;

  try {
      const incidenteResult = await db.query(`
          SELECT i.id_incidente, i.descripcion, i.estado, i.fecha_creacion, i.fecha_resolucion, i.resolucion,
                 e.nombre AS nombre_elemento, e.codigo, 
                 l.nombre AS nombre_localidad,
                 d.nombre AS nombre_departamento,
                 u.nombre AS nombre_tecnico,
                 enc.nombre AS nombre_encargado,
                 edif.nombre AS nombre_edificio,
                 
                 -- Campos para detalles de computadoras
                 comp.modelo AS modelo_computadora, comp.marca AS marca_computadora, comp.ram AS ram_computadora,
                 comp.procesador AS procesador_computadora, comp.sistema_operativo AS so_computadora,
                 comp.tipo_disco AS tipo_disco_computadora, comp.espacio_disco AS espacio_disco_computadora,
                 comp.tarjeta_grafica AS tarjeta_grafica_computadora, comp.fecha_compra AS fecha_compra_computadora,
                 comp.fecha_garantia AS fecha_garantia_computadora,

                 -- Campos para detalles de impresoras
                 imp.modelo AS modelo_impresora, imp.tipo_tinta AS tinta_impresora,
                 imp.marca AS marca_impresora, imp.fecha_compra AS fecha_compra_impresora,
                 imp.fecha_garantia AS fecha_garantia_impresora,

                 -- Campos para detalles de proyectores
                 proy.marca AS marca_proyector, proy.fecha_compra AS fecha_compra_proyector,
                 proy.fecha_garantia AS fecha_garantia_proyector, proy.modelo AS modelo_proyector,
                 proy.resolucion AS resolucion_proyector,

                 -- Campos para detalles de access points
                 access.direccion_ip AS direccion_ip_access, access.marca AS marca_access,
                 access.modelo AS modelo_access, access.numero_serie AS numero_serie_access,
                 access.fecha_compra AS fecha_compra_access, access.fecha_garantia AS fecha_garantia_access,

                 -- Campos para detalles de servidores
                 serv.nombre_servidor AS nombre_servidor_servidor, serv.fecha_compra AS fecha_compra_servidor,
                 serv.fecha_garantia AS fecha_garantia_servidor, serv.marca AS marca_servidor,
                 serv.modelo AS modelo_servidor,

                 -- Campos para detalles de switches
                 sw.marca AS marca_switch, sw.fecha_compra AS fecha_compra_switch,
                 sw.fecha_garantia AS fecha_garantia_switch, sw.puertos AS puertos_switch,
                 sw.numero_serie AS numero_serie_switch, sw.modelo AS modelo_switch
                 
          FROM incidentes i
          JOIN elementos e ON i.id_elemento = e.id_elemento
          LEFT JOIN localidades l ON e.id_localidad = l.id_localidad
          LEFT JOIN departamentos d ON i.id_departamento = d.id_departamento
          LEFT JOIN usuarios u ON i.id_tecnico = u.id_usuario
          LEFT JOIN encargados enc ON l.id_encargado = enc.id_encargado
          LEFT JOIN edificios edif ON l.id_edificio = edif.id_edificio
          LEFT JOIN computadoras comp ON e.id_elemento = comp.id_elemento
          LEFT JOIN impresoras imp ON e.id_elemento = imp.id_elemento
          LEFT JOIN proyectores proy ON e.id_elemento = proy.id_elemento
          LEFT JOIN access_points access ON e.id_elemento = access.id_elemento
          LEFT JOIN servidores serv ON e.id_elemento = serv.id_elemento
          LEFT JOIN switches sw ON e.id_elemento = sw.id_elemento
          WHERE i.id_incidente = $1
      `, [id_incidente]);

      if (incidenteResult.rows.length === 0) {
          return res.status(404).send("Incidente no encontrado");
      }

      res.render('verIncidencia', { incidente: incidenteResult.rows[0] });
  } catch (error) {
      console.error('Error al cargar los detalles de la incidencia:', error);
      res.status(500).send('Error al cargar los detalles de la incidencia');
  }
});

app.get('/verAnalisis', async (req, res) => {
  const id_incidente = req.query.id_incidente;

  try {
      const analisisResult = await db.query(`
          SELECT i.id_incidente, i.descripcion, i.resolucion, u.nombre AS nombre_tecnico
          FROM incidentes i
          LEFT JOIN usuarios u ON i.id_tecnico = u.id_usuario
          WHERE i.id_incidente = $1
      `, [id_incidente]);

      if (analisisResult.rows.length === 0) {
          return res.status(404).send("Análisis del incidente no encontrado");
      }

      res.render('verAnalisis', { incidente: analisisResult.rows[0] });
  } catch (error) {
      console.error('Error al cargar el análisis del incidente:', error);
      res.status(500).send('Error al cargar el análisis del incidente');
  }
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
    
  });


  app.get("/edificios", async (req, res) => {
    if (req.isAuthenticated()) {
        const usuario = res.locals.user;
        const id_departamento = usuario.id_departamento;

        const departamento = await db.query("SELECT nombre FROM departamentos WHERE id_departamento = $1", [id_departamento]);
        const edificios = await db.query("SELECT * FROM edificios WHERE id_departamento = $1 ORDER BY nombre ASC", [id_departamento]);

        // Cambia esta consulta para obtener los tipos de localidad en lugar de los tipos de elementos
        const tiposLocalidad = await db.query("SELECT * FROM tipos");

        const id_encargado = req.body.id_encargado;
        const encargado = (await db.query("SELECT nombre FROM encargados WHERE id_encargado = $1", [id_encargado])).rows[0];

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

            for (const localidad of localidades.rows) {
                const componentes = await db.query(`
                    SELECT * FROM elementos 
                    WHERE id_localidad = $1 
                    ORDER BY nombre ASC
                `, [localidad.id_localidad]);

                localidad.componentes = componentes.rows;
            }

            localidadesPorEdificio[edificio.id_edificio] = localidades.rows;
        }

        res.render("edificios.ejs", { 
            departamento: departamento.rows[0], 
            id_departamento: id_departamento, 
            edificios: edificios.rows, 
            tipos: tiposLocalidad.rows, // Cambia aquí la variable para enviar los tipos de localidad
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
  

