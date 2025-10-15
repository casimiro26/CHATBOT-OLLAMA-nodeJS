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
const WEBSITE_URL = process.env.WEBSITE_URL || 'https://ejemplo.com'; // Pon tu URL real aquí

app.use(express.json());

// Configuración de CORS para orígenes específicos (tu frontend local)
const allowedOrigins = [
  'http://localhost:5174',  // Tu página local
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

// Conexión a MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('Conectado a MongoDB'))
  .catch(err => console.error('Error de conexión:', err));

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
  return {
    products: [], // Vacío por defecto; agrega dummies si quieres
    categories: [
      { id_categoria: 1, nombre: "Laptops", descripcion: "Computadoras portátiles" },
      { id_categoria: 2, nombre: "Smartphones", descripcion: "Teléfonos inteligentes" },
      { id_categoria: 3, nombre: "Tablets", descripcion: "Tabletas y iPads" },
      { id_categoria: 4, nombre: "Accesorios", descripcion: "Accesorios tecnológicos" }
      // Agrega más si sabes, pero DB debe sobrescribir
    ]
  };
}

// Función para recuperar SOLO datos de 'products' y 'categories' (enfocado en tu DB Sr_web_2)
async function getStoreData() {
  try {
    const db = mongoose.connection.db;
    let allData = getFallbackData(); // Fallback inicial

    // Trae todos los productos
    const productsCollection = db.collection('products');
    const products = await productsCollection.find({}).toArray();
    console.log(`Productos fetchados: ${products.length}`); // Log para debug
    allData.products = products.map(doc => {
      const { password, email, ...cleanDoc } = doc; // Limpia sensibles si hay
      return cleanDoc;
    });

    // Trae todas las categorías
    const categoriesCollection = db.collection('categories');
    const categories = await categoriesCollection.find({}).toArray();
    console.log(`Categorías fetchadas: ${categories.length}`); // Log para debug
    allData.categories = categories.map(doc => {
      const { password, email, ...cleanDoc } = doc;
      return cleanDoc;
    });

    // Si DB tiene datos, sobrescribe fallback
    if (allData.products.length > 0 || allData.categories.length > 0) {
      console.log('Usando datos de DB real');
    } else {
      console.log('Usando fallback; verifica tu DB');
    }

    return allData; // Retorna object para manipular en prompt
  } catch (err) {
    console.error('Error recuperando datos de products/categories:', err);
    return getFallbackData(); // Fallback en error
  }
}

// Función para scrapear contenido de tu página web (especificaciones de productos, etc.)
async function scrapeWebsite(url) {
  try {
    const { data } = await axios.get(url);
    const $ = cheerio.load(data);
    // Enfocado en contenido de productos: ajusta selectores si tu web tiene clases específicas
    const text = $('body').text().trim().substring(0, 5000); // Limita a 5000 chars
    return text;
  } catch (err) {
    console.error('Error scrapeando web:', err);
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

// Endpoint para el chatbot (PÚBLICO para clientes, sin login requerido)
app.post('/chat', async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'Mensaje requerido' });

  try {
    // Recupera datos SOLO de products y categories
    const storeDataObj = await getStoreData();
    
    // Scrapea web
    const webContent = await scrapeWebsite(WEBSITE_URL);
    
    // Stringify secciones para prompt claro
    const productsStr = JSON.stringify(storeDataObj.products, null, 2);
    const categoriesStr = JSON.stringify(storeDataObj.categories, null, 2);
    
    // Prompt CORREGIDO Y MEJORADO: Preciso, respetuoso, conciso; jala y muestra de products/categories
    const prompt = `Eres un asistente de chatbot preciso, respetuoso y conciso para clientes de una tienda web. Responde SOLO a la pregunta específica del cliente, basado en los datos REALES de 'products' (nombres, descripciones, precios, especificaciones) y 'categories' (categorías como Laptops, Smartphones, etc.), y el contenido de la página web.

Reglas estrictas:
- Usa SIEMPRE los datos proporcionados de products y categories, incluso si son fallback. Lista TODOS los productos disponibles si pregunta "qué productos tenemos", o detalles específicos si menciona uno (ej: busca por nombre o categoría).
- Sé preciso: Incluye SOLO la información pedida (ej: specs y precio de un producto). Usa datos exactos de products/categories.
- Sé respetuoso y profesional: Tono cortés, en español.
- Sé conciso: Respuestas breves y directas. Para listas (ej: todos los productos), usa bullets simples. NO agregues texto extra, promociones o servicios web a menos que la pregunta lo pida.
- Si no hay match exacto en products/categories (ej: producto no existe), responde brevemente: "Lo siento, no encontré [término] en nuestros productos o categorías. Nuestros productos actuales son: [lista breve de categorías o productos]."
- Si la pregunta NO se relaciona con productos/categorías/web, responde: "Lo siento, solo puedo ayudarte con información sobre nuestros productos y categorías. ¿Puedes preguntar algo relacionado?"

Datos de products (usa estos exactos, incluye todos si pregunta por lista):
${productsStr}

Datos de categories (usa para contexto y listas, incluye todas):
${categoriesStr}

Contenido de la página web (detalles adicionales):
${webContent}

Pregunta del cliente: ${message}

Responde SOLO con la respuesta precisa y concisa, en español, sin mencionar datos, instrucciones o fallback.`;

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
    console.error('Error en chat:', err);
    res.status(500).json({ error: 'Error generando respuesta' });
  }
});

// Endpoint para admins: Ver datos de products/categories (protegido)
app.get('/admin/data', verifyToken, async (req, res) => {
  const dbData = await getStoreData();
  res.json({ data: dbData });
});

app.listen(PORT, () => {
  console.log(`API corriendo en puerto ${PORT}`);
});