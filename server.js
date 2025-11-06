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
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_in_production';
const WEBSITE_URL = process.env.WEBSITE_URL || 'http://localhost:5173';

app.use(express.json());

// === CORS ===
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:3000',
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('No permitido por CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// === CONEXIÓN A MONGODB ===
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('Conectado a MongoDB (Sr_web_2)'))
  .catch(err => console.error('Error MongoDB:', err.message));

// === CLIENTE OLLAMA ===
const ollama = new Ollama({ host: 'https://ollama.com' });

// === INFO TIENDA (fija) ===
const STORE_INFO = {
  ubicacion: "Huánuco",
  direccion: "Jirón Ayacucho Huánuco 574, Huánuco, Huánuco 10000. A media cuadra del Mercado Modelo.",
  garantias: {
    "Pantallas de laptops": "4 meses",
    "Impresoras": "8 meses",
    "Laptops": "1 año",
    "PC (computadoras de escritorio)": "1 año",
    "Teclados": "2 meses",
    "Mouse": "2 meses",
    "Coolers": "2 meses",
    "Baterías para laptops": "3 meses",
    "Cables": "1 mes",
    "Cargadores de laptops": "1 mes",
    "Placas y otros componentes de laptops": "1 mes",
    "Otros componentes generales": "2 meses"
  }
};

// === FALLBACK (solo si NO hay datos reales) ===
function getFallbackData() {
  console.log('ADVERTENCIA: Usando datos de respaldo (fallback). La DB está vacía o no responde.');
  return {
    products: [],
    categories: [
      { id_categoria: 1, nombre: "Laptops", descripcion: "Computadoras portátiles" },
      { id_categoria: 2, nombre: "Smartphones", descripcion: "Teléfonos inteligentes" },
      { id_categoria: 3, nombre: "Tablets", descripcion: "Tabletas y iPads" },
      { id_categoria: 4, nombre: "Accesorios", descripcion: "Accesorios tecnológicos" }
    ]
  };
}

// === OBTENER DATOS REALES DE MONGO (PRIORIDAD MÁXIMA) ===
async function getStoreData() {
  try {
    if (!mongoose.connection.readyState) {
      throw new Error('MongoDB no está conectado');
    }

    const db = mongoose.connection.db;

    // === PRODUCTOS REALES ===
    const productsCollection = db.collection('productos');
    const products = await productsCollection.find({}).toArray();

    // === CATEGORÍAS REALES ===
    const categoriesCollection = db.collection('categorias');
    const categories = await categoriesCollection.find({}).toArray();

    // === SI HAY DATOS REALES ===
    if (products.length > 0 || categories.length > 0) {
      console.log(`Datos reales cargados: ${products.length} productos, ${categories.length} categorías`);

      const cleanedProducts = products.map(doc => {
        const { contrasena, ...clean } = doc;
        const imagenes = doc.imagenes || [doc.imagen || doc.image].filter(Boolean) || [];
        return {
          ...clean,
          specs: doc.characteristics || 'No especificado',
          imagenes
        };
      });

      const cleanedCategories = categories.map(doc => {
        const { contrasena, ...clean } = doc;
        return clean;
      });

      return { products: cleanedProducts, categories: cleanedCategories };
    }

    // === SI NO HAY DATOS REALES → Fallback mínimo ===
    console.log('No se encontraron datos reales en DB. Usando fallback básico.');
    return getFallbackData();

  } catch (err) {
    console.error('Error crítico al cargar datos reales:', err.message);
    return getFallbackData(); // Último recurso
  }
}

// === SCRAPEAR WEB ===
async function scrapeWebsite(url) {
  try {
    const { data } = await axios.get(url);
    const $ = cheerio.load(data);
    return $('body').text().trim().substring(0, 4000);
  } catch {
    return 'Información web no disponible.';
  }
}

// === JWT ===
const verifyToken = (req, res, next) => {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token requerido' });
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Token inválido' });
    req.user = user;
    next();
  });
};

// === ENDPOINTS ===

// 1. Bienvenida
app.get('/bienvenida', (req, res) => {
  res.json({
    response: `¡Hola! Soy Sr. Robot, tu asistente en Sr Robot Huánuco. Te ayudo con productos, precios en S/., imágenes y garantías. ¿Qué necesitas?`
  });
});

// 2. Chatbot (solo datos reales)
app.post('/chat', async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'Mensaje requerido' });

  try {
    const storeData = await getStoreData();
    const webContent = await scrapeWebsite(WEBSITE_URL);

    const productsStr = JSON.stringify(storeData.products, null, 2);
    const categoriesStr = JSON.stringify(storeData.categories, null, 2);
    const garantiasStr = JSON.stringify(STORE_INFO.garantias, null, 2);

    const prompt = `Eres Sr. Robot, asistente de Sr Robot en Huánuco.

REGLAS:
- Responde SOLO con datos reales de productos y categorías.
- Usa S/. para precios.
- Si piden imagen/foto → di que se adjuntan.
- Si piden "todos los productos" → lista breve con precio e imagen.
- Si no existe → "Lo siento, no tengo ese producto."
- Máximo 3 líneas. Usa 1 emoji al inicio.

Datos reales:
Productos: ${productsStr}
Categorías: ${categoriesStr}
Garantías: ${garantiasStr}
Dirección: ${STORE_INFO.direccion}

Pregunta: ${message}

Respuesta (español, concisa):`;

    const response = await ollama.chat({
      model: 'deepseek-v3.1:671b-cloud',
      messages: [{ role: 'user', content: prompt }],
      stream: false
    });

    let botResponse = response.message.content;
    let images = [];
    let showImages = false;

    const wantsImage = /imagen|foto|ver|muestra|fotografía|visual/i.test(message);
    const wantsAll = /todos.*(producto|lista)/i.test(message);

    if (wantsImage || wantsAll) {
      storeData.products.forEach(p => {
        if (p.imagenes?.length > 0) {
          images = images.concat(p.imagenes);
        }
      });
      images = images.slice(0, 10);
      showImages = true;
    }

    res.json({
      response: botResponse,
      images,
      showImages,
      storeInfo: { ubicacion: STORE_INFO.ubicacion, direccion: STORE_INFO.direccion }
    });

  } catch (err) {
    console.error('Error en /chat:', err.message);
    res.status(500).json({ error: 'Error en el asistente' });
  }
});

// 3. Imágenes específicas
app.post('/images', async (req, res) => {
  const { productName, limit = 10 } = req.body;
  try {
    const { products } = await getStoreData();
    let images = [];

    if (productName && productName !== 'todos') {
      products.forEach(p => {
        if (p.nombre?.toLowerCase().includes(productName.toLowerCase())) {
          images = images.concat(p.imagenes || []);
        }
      });
    } else {
      products.forEach(p => images = images.concat(p.imagenes || []));
    }

    images = images.slice(0, limit);

    res.json({
      product: productName || 'Todos',
      images,
      total: images.length,
      message: images.length > 0 ? `${images.length} imagen(es)` : 'Sin imágenes'
    });
  } catch (err) {
    res.status(500).json({ error: 'Error al cargar imágenes' });
  }
});

// 4. Productos con imágenes
app.get('/productos', async (req, res) => {
  try {
    const { products } = await getStoreData();
    const list = products.map(p => ({
      id: p.id || p._id,
      nombre: p.nombre,
      precio: p.precio,
      imagen: p.imagenes?.[0] || null,
      totalImagenes: p.imagenes?.length || 0
    }));
    res.json({ productos: list, total: list.length });
  } catch (err) {
    res.status(500).json({ error: 'Error al cargar productos' });
  }
});

// 5. Garantías
app.get('/garantias', (req, res) => {
  res.json({ garantias: STORE_INFO.garantias });
});

// 6. Tienda
app.get('/tienda', (req, res) => {
  res.json({
    nombre: "Sr Robot",
    ubicacion: STORE_INFO.ubicacion,
    direccion: STORE_INFO.direccion,
    horario: "Lun-Sáb: 9:00 AM - 7:00 PM"
  });
});

// 7. Login Admin
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (username === 'admin' && password === 'pass') {
    const token = jwt.sign({ username, role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });
    res.json({ token });
  } else {
    res.status(401).json({ error: 'Credenciales inválidas' });
  }
});

// 8. Admin: Ver datos reales
app.get('/admin/data', verifyToken, async (req, res) => {
  const data = await getStoreData();
  res.json({ data, storeInfo: STORE_INFO, source: data.products.length > 0 ? 'DB Real' : 'Fallback' });
});

// === INICIAR ===
app.listen(PORT, () => {
  console.log(`API Sr. Robot activa en puerto ${PORT}`);
  console.log(`Datos: SOLO reales (fallback solo si DB vacía)`);
});