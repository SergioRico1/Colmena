// What the welcome flow (screens/BienvenidaV2.jsx) proposes before any account is connected:
// the stock bots, a team with roles already made for each line of work and its first tasks.
// Scripted on purpose: nothing is sent anywhere.

export const B = {
  atlas: { id: "atlas", name: "Atlas", role: "Coordinador", color: "#12131A", shape: "hex" },
  nora: { id: "nora", name: "Nora", role: "Investigación", color: "#2F6BFF", shape: "circle" },
  tomas: { id: "tomas", name: "Tomás", role: "Datos y finanzas", color: "#0B8A5F", shape: "square" },
  iris: { id: "iris", name: "Iris", role: "Diseño", color: "#FF5CA8", shape: "diamond" },
  bruno: { id: "bruno", name: "Bruno", role: "Código", color: "#FF7A1A", shape: "arch" },
  vera: { id: "vera", name: "Vera", role: "Redacción", color: "#7B4DFF", shape: "leaf" },
  leo: { id: "leo", name: "Leo", role: "Asistente legal", color: "#0E7C86", shape: "circle" },
};
export const ROLES = [
  { id: "diseno", label: "Diseño", team: [["atlas", "Reparte el trabajo y te trae un único resultado."], ["iris", "Maquetas, presentaciones y piezas visuales."], ["vera", "Titulares y textos que acompañan al diseño."], ["nora", "Referencias y lo que hace la competencia."]],
    tasks: ["Prepara un moodboard con referencias para una web nueva", "Revisa si los colores y la tipografía de este documento son coherentes", "Escribe cinco titulares para la próxima campaña"] },
  { id: "programacion", label: "Programación", team: [["atlas", "Reparte el trabajo y vigila los plazos."], ["bruno", "Scripts, revisiones de código y pruebas."], ["nora", "Lee documentación y busca soluciones."], ["vera", "Documenta y explica los cambios."]],
    tasks: ["Revisa este script y propón mejoras", "Resume los pasos para actualizar una librería a su última versión", "Escribe el README de un proyecto a partir de su código"] },
  { id: "finanzas", label: "Finanzas y economía", team: [["atlas", "Reparte el trabajo y te trae un único resultado."], ["tomas", "Hojas de cálculo, cierres y previsiones."], ["nora", "Informes, datos públicos y mercado."], ["vera", "Resúmenes claros para dirección."]],
    tasks: ["Prepara una previsión de tesorería para el próximo trimestre", "Compara tres bancos para la cuenta de la empresa", "Resume en una tabla los gastos de este mes"] },
  { id: "marketing", label: "Marketing", team: [["atlas", "Coordina campañas de principio a fin."], ["vera", "Textos, correos y redes."], ["iris", "Piezas visuales y variantes."], ["nora", "Competencia y tendencias."]],
    tasks: ["Propón un calendario de publicaciones para las próximas cuatro semanas", "Analiza qué está haciendo la competencia en redes", "Redacta un correo de bienvenida para clientes nuevos"] },
  { id: "operaciones", label: "Operaciones", team: [["atlas", "Reparte el trabajo y vigila los plazos."], ["tomas", "Costes, proveedores y cuadros de mando."], ["bruno", "Automatiza las tareas repetidas."], ["vera", "Comunicaciones internas."]],
    tasks: ["Compara los precios de tres proveedores", "Diseña un cuadro de mando con los costes del mes", "Propón cómo automatizar una tarea que repito cada semana"] },
  { id: "legal", label: "Legal", team: [["atlas", "Reparte el trabajo y vigila los plazos."], ["leo", "Contratos, cláusulas y renovaciones."], ["nora", "Normativa y documentación."], ["vera", "Redacta y revisa escritos."]],
    tasks: ["Revisa este contrato y señala las cláusulas de riesgo", "Haz una lista de los contratos que vencen este trimestre", "Resume la normativa de protección de datos que nos afecta"] },
  { id: "personas", label: "Personas y RR. HH.", team: [["atlas", "Coordina procesos de principio a fin."], ["vera", "Ofertas de empleo y comunicaciones."], ["nora", "Prepara entrevistas y estudios."], ["tomas", "Calendarios, vacaciones y datos."]],
    tasks: ["Redacta una oferta de empleo para un puesto nuevo", "Prepara las preguntas de una entrevista", "Organiza el calendario de vacaciones del equipo"] },
  { id: "clientes", label: "Atención al cliente", team: [["atlas", "Reparte las consultas y vigila que nadie se quede sin respuesta."], ["vera", "Respuestas claras y correos a clientes."], ["nora", "Busca la información que piden."], ["tomas", "Incidencias, plazos y datos de clientes."]],
    tasks: ["Prepara respuestas para las cinco preguntas que más nos hacen los clientes", "Resume las quejas de este mes y qué tienen en común", "Redacta una respuesta amable a un cliente que espera su pedido"] },
  { id: "otra", label: "Otra cosa", team: [["atlas", "Reparte el trabajo entre el equipo."], ["nora", "Busca, lee y resume."], ["vera", "Escribe y corrige."], ["tomas", "Números y hojas de cálculo."]],
    tasks: ["Prepárame la semana: lo que tengo pendiente y por dónde empezar", "Busca tres proveedores de material de oficina y compáralos", "Ordena la carpeta Descargas", "Resume este documento en cinco puntos"] },
];
// A first task that uses what you said you use.
export const APP_TASK = {
  correo: "Resume los correos importantes que me llegaron ayer",
  calendario: "Mira mi calendario de esta semana y dime dónde tengo huecos",
  hojas: "Revisa mi hoja de gastos y dime qué ha subido este mes",
  carpetas: "Ordena y resume los documentos de una de mis carpetas",
};
