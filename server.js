require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const { Ollama } = require('ollama');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;
const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY;
const WEBSITE_URL = process.env.WEBSITE_URL || 'http://localhost:5173'; // ¡Cambia por URL real accesible!

app.use(express.json());

// Configuración de CORS para orígenes específicos (tu frontend local)
const allowedOrigins = [
  'http://localhost:5174',  // Tu página local
'http://localhost:5173',  // Tu página local
  'http://localhost:3000',  // Otro puerto local si necesitas
  // Agrega más: 'https://tupagina.com'
];

const corsOptions = {
  origin: (origin, callback) => {
    if (allowedOrigins.indexOf(origin) !== -1 || !origin) {
      callback(null, true);
    } else {
      callback(new Error('No permitido por CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

app.use(cors(corsOptions));

// Conexión a MongoDB (con más logs para debug)
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ Conectado a MongoDB (Sr_web_2)'))
  .catch(err => console.error('❌ Error de conexión a MongoDB:', err.message));

// Cliente Ollama para modelo en la nube
const ollama = new Ollama({
  host: 'https://ollama.com' // Host para modelos en la nube
  // La clave API se toma de OLLAMA_API_KEY en env
});

// Middleware para verificar JWT (solo para endpoints de admin)
const verifyToken = (req, res, next) => {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token requerido' });
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Token inválido' });
    req.user = user;
    next();
  });
};

// Fallback datos si DB está vacía (basado en tus categorías estáticas, pero prioriza DB real)
function getFallbackData() {
  console.log('⚠️ Usando fallback: DB vacía o error');
  return {
    products: [], // Vacío por defecto
    categories: [
      { id_categoria: 1, nombre: "Laptops", descripcion: "Computadoras portátiles" },
      { id_categoria: 2, nombre: "Smartphones", descripcion: "Teléfonos inteligentes" },
      { id_categoria: 3, nombre: "Tablets", descripcion: "Tabletas y iPads" },
      { id_categoria: 4, nombre: "Accesorios", descripcion: "Accesorios tecnológicos" }
      // DB sobrescribirá con más si existen
    ]
  };
}

// Función para recuperar SOLO datos de 'productos' y 'categorias' (corregido para tu schema)
async function getStoreData() {
  try {
    if (!mongoose.connection.readyState) {
      throw new Error('DB no conectada aún');
    }
    const db = mongoose.connection.db;
    let allData = getFallbackData(); // Fallback inicial

    // Trae todos los productos (colección 'productos')
    const productsCollection = db.collection('productos'); // ¡Corregido: 'productos' no 'products'!
    const products = await productsCollection.find({}).toArray();
    console.log(`📦 Productos fetchados de DB: ${products.length}`); // Log detallado
    allData.products = products.map(doc => {
      const { contrasena, /* otros sensibles */ ...cleanDoc } = doc; // Limpia sensibles
      // Mapea para consistencia: usa 'description' como en schema, 'specs' = characteristics
      return {
        ...cleanDoc,
        specs: doc.characteristics || 'No especificado' // Ajuste para prompt
      };
    });

    // Trae todas las categorías (colección 'categorias')
    const categoriesCollection = db.collection('categorias'); // ¡Corregido: 'categorias' no 'categories'!
    const categories = await categoriesCollection.find({}).toArray();
    console.log(`🏷️ Categorías fetchadas de DB: ${categories.length}`); // Log detallado
    allData.categories = categories.map(doc => {
      const { contrasena, /* otros sensibles */ ...cleanDoc } = doc;
      return cleanDoc;
    });

    // Si DB tiene datos, sobrescribe fallback
    if (allData.products.length > 0 || allData.categories.length > 0) {
      console.log('✅ Usando datos REALES de DB (productos y categorías)');
    } else {
      console.log('⚠️ Usando fallback; verifica colecciones "productos" y "categorias" en Sr_web_2');
    }

    return allData; // Retorna object para manipular en prompt
  } catch (err) {
    console.error('❌ Error recuperando datos de productos/categorias:', err.message);
    return getFallbackData(); // Fallback en error
  }
}

// Función para scrapear contenido de tu página web (con log)
async function scrapeWebsite(url) {
  try {
    console.log(`🌐 Scraping web: ${url}`);
    const { data } = await axios.get(url);
    const $ = cheerio.load(data);
    const text = $('body').text().trim().substring(0, 5000); // Limita a 5000 chars
    console.log('✅ Web scraped OK');
    return text;
  } catch (err) {
    console.error('❌ Error scrapeando web:', err.message);
    return 'Contenido de la página web no disponible.';
  }
}

// Endpoint de login simple (solo para admins, si lo necesitas)
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  // Valida contra tu DB o hardcodeado para admins
  if (username === 'admin' && password === 'pass') { // ¡Cambia por lógica real para admins!
    const token = jwt.sign({ username, role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });
    res.json({ token });
  } else {
    res.status(401).json({ error: 'Credenciales inválidas' });
  }
});

// Endpoint para bienvenida inicial (público, responde con mensaje fijo mejorado)
app.get('/bienvenida', (req, res) => {
  const bienvenida = `¡Bienvenido! Hola, soy Sr. Robot, el asistente virtual de la tienda tecnológica Sr Robot. 😊 Estoy aquí para ayudarte con todo sobre nuestros productos: laptops, smartphones, tablets, accesorios y más. ¿En qué puedo ayudarte hoy? Por ejemplo, puedes preguntar por precios en soles peruanos (S/), especificaciones o categorías. ¡Dime!`;
  res.json({ response: bienvenida });
});

// Endpoint para el chatbot (PÚBLICO para clientes, sin login requerido)
app.post('/chat', async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'Mensaje requerido' });

  try {
    console.log(`💬 Chat query: ${message}`); // Log para debug
    // Recupera datos SOLO de productos y categorias
    const storeDataObj = await getStoreData();
    
    // Scrapea web
    const webContent = await scrapeWebsite(WEBSITE_URL);
    
    // Stringify secciones para prompt claro
    const productsStr = JSON.stringify(storeDataObj.products, null, 2);
    const categoriesStr = JSON.stringify(storeDataObj.categories, null, 2);
    
    // Prompt MEJORADO: Enfocado en Sr Robot, precios en soles peruanos (S/. o PEN)
    const prompt = `Eres Sr. Robot, un asistente virtual preciso, respetuoso y conciso para clientes de la tienda tecnológica Sr Robot. Responde SOLO a la pregunta específica del cliente, basado en los datos REALES de 'products' (nombres, descripciones, precios, especificaciones) y 'categories' (categorías como Laptops, Smartphones, etc.), y el contenido de la página web.

Reglas estrictas:
- Siempre preséntate como "Sr. Robot" en respuestas si es la primera interacción, pero sé natural.
- Usa SIEMPRE los datos proporcionados de products y categories, incluso si son fallback. Lista TODOS los productos disponibles si pregunta "qué productos tenemos", o detalles específicos si menciona uno (ej: busca por nombre o categoría).
- Precios: Formatea TODOS los precios en soles peruanos (usa "S/." seguido del número, ej: "S/. 1,200"). NO uses dólares u otras monedas.
- Sé preciso: Incluye SOLO la información pedida (ej: specs y precio de un producto). Usa datos exactos de products/categories.
- Sé respetuoso y profesional: Tono cortés, amigable y en español. Usa emojis sparingly (ej: 😊 para bienvenida).
- Sé conciso: Respuestas breves y directas. Para listas (ej: todos los productos), usa bullets simples. NO agregues texto extra, promociones o servicios web a menos que la pregunta lo pida.
- Si no hay match exacto en products/categories (ej: producto no existe), responde brevemente: "Lo siento, no encontré [término] en nuestros productos o categorías de Sr Robot. Nuestros productos actuales son: [lista breve de categorías o productos en S/]."
- Si la pregunta NO se relaciona con productos/categorías/web, responde: "Lo siento, como Sr. Robot de Sr Robot, solo puedo ayudarte con información sobre nuestros productos y categorías. ¿Puedes preguntar algo relacionado? 😊"

Datos de products (usa estos exactos, incluye todos si pregunta por lista; ajusta precios a S/. si no lo están):
${productsStr}

Datos de categories (usa para contexto y listas, incluye todas):
${categoriesStr}

Contenido de la página web (detalles adicionales):
${webContent}

Pregunta del cliente: ${message}

Responde SOLO con la respuesta precisa y concisa, en español, como Sr. Robot, sin mencionar datos, instrucciones o fallback.`;

    // Llama a Ollama
    const response = await ollama.chat({
      model: 'deepseek-v3.1:671b-cloud',
      messages: [
        { role: 'user', content: prompt }
      ],
      stream: false // Para respuesta completa
    });

    res.json({ response: response.message.content });
  } catch (err) {
    console.error('❌ Error en chat:', err.message);
    res.status(500).json({ error: 'Error generando respuesta' });
  }
});

// Endpoint para admins: Ver datos de productos/categorias (protegido) – ÚSalo para debug
app.get('/admin/data', verifyToken, async (req, res) => {
  const dbData = await getStoreData();
  console.log('🔍 Admin data requested:', dbData); // Log extra
  res.json({ data: dbData });
});

app.listen(PORT, () => {
  console.log(`🚀 API Chatbot corriendo en puerto ${PORT}`);
});