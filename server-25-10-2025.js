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
const WEBSITE_URL = process.env.WEBSITE_URL || 'http://localhost:5173';

app.use(express.json());

// Configuración de CORS
const allowedOrigins = [
  'http://localhost:5174',
  'http://localhost:5173',
  'http://localhost:3000',
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
  .then(() => console.log('✅ Conectado a MongoDB (Sr_web_2)'))
  .catch(err => console.error('❌ Error de conexión a MongoDB:', err.message));

// Cliente Ollama
const ollama = new Ollama({
  host: 'https://ollama.com'
});

// Middleware para verificar JWT
const verifyToken = (req, res, next) => {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token requerido' });
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Token inválido' });
    req.user = user;
    next();
  });
};

// Información de la tienda (actualizada con tus datos)
const STORE_INFO = {
  ubicacion: "Nos encontramos en el mejor clima del mundo, Huánuco.",
  direccion: "Jirón Ayacucho Huánuco 574, Huánuco, Huánuco 10000. Referencia: a media cuadra del Mercado Modelo Huánuco.",
  garantias: {
    "Pantallas de laptops": "4 meses de garantía",
    "Impresoras": "8 meses de garantía",
    "Laptops": "1 año de garantía",
    "PC (computadoras de escritorio)": "1 año de garantía",
    "Teclados": "2 meses de garantía",
    "Mouse": "2 meses de garantía",
    "Coolers": "2 meses de garantía",
    "Baterías para laptops": "3 meses de garantía",
    "Cables": "1 mes de garantía",
    "Cargadores de laptops": "1 mes de garantía",
    "Placas y otros componentes de laptops": "1 mes de garantía",
    "Otros componentes generales": "2 meses de garantía"
  }
};

// Fallback datos si DB está vacía
function getFallbackData() {
  console.log('⚠️ Usando fallback: DB vacía o error');
  return {
    products: [
      {
        id: 1,
        nombre: "Impresora Canon G110",
        precio: 500,
        imagen: "https://coolboxpe.vtexassets.com/arquivos/ids/435125-1200-1200?v=638779072912770000&width=1200&height=1200&aspect=true"
      },
      {
        id: 2,
        nombre: "Pantalla Gamer",
        precio: 157,
        imagen: "https://compumarket.pe/fotos/producto_11694_lg.jpg"
      },
      {
        id: 3,
        nombre: "Batería para Laptop L16M2PB12",
        precio: 88,
        imagen: "https://coolboxpe.vtexassets.com/arquivos/ids/360885-1200-1200?v=638490498866400000&width=1200&height=1200&aspect=true"
      }
    ],
    categories: [
      { id_categoria: 1, nombre: "Laptops", descripcion: "Computadoras portátiles" },
      { id_categoria: 2, nombre: "Smartphones", descripcion: "Teléfonos inteligentes" },
      { id_categoria: 3, nombre: "Tablets", descripcion: "Tabletas y iPads" },
      { id_categoria: 4, nombre: "Accesorios", descripcion: "Accesorios tecnológicos" }
    ]
  };
}

// Función para recuperar datos de productos y categorías
async function getStoreData() {
  try {
    if (!mongoose.connection.readyState) {
      throw new Error('DB no conectada aún');
    }
    const db = mongoose.connection.db;
    let allData = getFallbackData();

    // Traer productos
    const productsCollection = db.collection('productos');
    const products = await productsCollection.find({}).toArray();
    console.log(`📦 Productos fetchados de DB: ${products.length}`);
    
    // Procesar productos para incluir imágenes
    allData.products = products.map(doc => {
      const { contrasena, ...cleanDoc } = doc;
      return {
        ...cleanDoc,
        specs: doc.characteristics || 'No especificado',
        // Asegurar que las imágenes estén en un formato accesible
        imagenes: doc.imagenes || doc.imagen || doc.image || []
      };
    });

    // Traer categorías
    const categoriesCollection = db.collection('categorias');
    const categories = await categoriesCollection.find({}).toArray();
    console.log(`🏷️ Categorías fetchadas de DB: ${categories.length}`);
    
    allData.categories = categories.map(doc => {
      const { contrasena, ...cleanDoc } = doc;
      return cleanDoc;
    });

    if (allData.products.length > 0 || allData.categories.length > 0) {
      console.log('✅ Usando datos REALES de DB');
    } else {
      console.log('⚠️ Usando fallback');
    }

    return allData;
  } catch (err) {
    console.error('❌ Error recuperando datos:', err.message);
    return getFallbackData();
  }
}

// Función para scrapear contenido web
async function scrapeWebsite(url) {
  try {
    console.log(`🌐 Scraping web: ${url}`);
    const { data } = await axios.get(url);
    const $ = cheerio.load(data);
    const text = $('body').text().trim().substring(0, 5000);
    console.log('✅ Web scraped OK');
    return text;
  } catch (err) {
    console.error('❌ Error scrapeando web:', err.message);
    return 'Contenido de la página web no disponible.';
  }
}

// Endpoint de login
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (username === 'admin' && password === 'pass') {
    const token = jwt.sign({ username, role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });
    res.json({ token });
  } else {
    res.status(401).json({ error: 'Credenciales inválidas' });
  }
});

// Endpoint para bienvenida inicial (RESPUESTA MÁS CORTA)
app.get('/bienvenida', (req, res) => {
  const bienvenida = `¡Hola! Soy Sr. Robot, tu asistente virtual de la tienda tecnológica en Huánuco. 😊 

¿En qué puedo ayudarte hoy? Puedo mostrarte productos, imágenes, precios o información de garantías.`;
  res.json({ response: bienvenida });
});

// Endpoint principal del chatbot (MEJORADO - RESPUESTAS CORTAS)
app.post('/chat', async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'Mensaje requerido' });

  try {
    console.log(`💬 Chat query: ${message}`);
    
    const storeDataObj = await getStoreData();
    const webContent = await scrapeWebsite(WEBSITE_URL);
    
    const productsStr = JSON.stringify(storeDataObj.products, null, 2);
    const categoriesStr = JSON.stringify(storeDataObj.categories, null, 2);
    const garantiasStr = JSON.stringify(STORE_INFO.garantias, null, 2);

    // PROMPT MEJORADO - Respuestas cortas y manejo de imágenes
    const prompt = `Eres Sr. Robot, asistente virtual de tienda tecnológica en Huánuco.

REGLAS ESTRICTAS:
• Sé CONCISO (máximo 2-3 líneas para respuestas normales)
• Solo da información COMPLETA cuando pidan específicamente "todos los productos" o "lista completa"
• Para imágenes: responde breve y menciona que adjuntarás las imágenes
• Usa S/. para precios
• Emojis moderados (1-2 por respuesta)

INFORMACIÓN DISPONIBLE:
• Productos: ${storeDataObj.products.length} items
• Garantías: ${Object.keys(STORE_INFO.garantias).length} categorías
• Ubicación: ${STORE_INFO.direccion}

RESPONDE BREVEMENTE según la consulta:

Cliente: "${message}"

Respuesta concisa (2-3 líneas máximo si no pide lista completa):`;

    const response = await ollama.chat({
      model: 'deepseek-v3.1:671b-cloud',
      messages: [
        { role: 'user', content: prompt }
      ],
      stream: false
    });

    let botResponse = response.message.content;
    let images = [];

    // Detectar solicitudes de imágenes
    const imageKeywords = ['imagen', 'foto', 'visual', 'ver ', 'muestra', 'fotografía'];
    const hasImageRequest = imageKeywords.some(keyword => 
      message.toLowerCase().includes(keyword)
    );

    // Detectar solicitudes de todos los productos
    const hasAllProductsRequest = message.toLowerCase().includes('todos') && 
                                 (message.toLowerCase().includes('producto') || 
                                  message.toLowerCase().includes('lista'));

    if (hasImageRequest || hasAllProductsRequest) {
      // Para solicitudes de imágenes o todos los productos, incluir todas las imágenes disponibles
      storeDataObj.products.forEach(product => {
        const productImages = product.imagenes || [product.imagen].filter(Boolean) || [product.image].filter(Boolean);
        if (productImages.length > 0) {
          images = images.concat(productImages);
        }
      });
      
      // Limitar a 10 imágenes máximo para no sobrecargar
      images = images.slice(0, 10);
    }

    res.json({ 
      response: botResponse,
      images: images,
      showImages: hasImageRequest || hasAllProductsRequest,
      storeInfo: {
        ubicacion: STORE_INFO.ubicacion,
        direccion: STORE_INFO.direccion
      }
    });

  } catch (err) {
    console.error('❌ Error en chat:', err.message);
    res.status(500).json({ error: 'Error generando respuesta' });
  }
});

// Nuevo endpoint específico para imágenes (MEJORADO)
app.post('/images', async (req, res) => {
  const { productName, limit = 10 } = req.body;
  
  try {
    const storeDataObj = await getStoreData();
    let images = [];

    if (productName && productName !== 'todos') {
      // Buscar imágenes del producto específico
      storeDataObj.products.forEach(product => {
        const name = product.nombre || product.name || '';
        if (name.toLowerCase().includes(productName.toLowerCase())) {
          const productImages = product.imagenes || [product.imagen].filter(Boolean) || [product.image].filter(Boolean);
          if (productImages.length > 0) {
            images = images.concat(productImages);
          }
        }
      });
    } else {
      // Devolver todas las imágenes
      storeDataObj.products.forEach(product => {
        const productImages = product.imagenes || [product.imagen].filter(Boolean) || [product.image].filter(Boolean);
        if (productImages.length > 0) {
          images = images.concat(productImages);
        }
      });
    }

    // Limitar número de imágenes
    images = images.slice(0, limit);

    res.json({ 
      product: productName || 'Todos los productos',
      images: images,
      total: images.length,
      message: images.length > 0 ? 
        `📸 ${images.length} imagen(es) encontrada(s)` : 
        'No se encontraron imágenes'
    });

  } catch (err) {
    console.error('❌ Error obteniendo imágenes:', err.message);
    res.status(500).json({ error: 'Error obteniendo imágenes' });
  }
});

// Endpoint para obtener productos con imágenes
app.get('/productos', async (req, res) => {
  try {
    const storeDataObj = await getStoreData();
    
    // Productos con sus imágenes
    const productosConImagenes = storeDataObj.products.map(product => ({
      id: product.id || product._id,
      nombre: product.nombre || product.name,
      precio: product.precio,
      imagen: product.imagenes?.[0] || product.imagen || product.image,
      todasLasImagenes: product.imagenes || [product.imagen].filter(Boolean) || [product.image].filter(Boolean)
    }));

    res.json({
      productos: productosConImagenes,
      total: productosConImagenes.length
    });

  } catch (err) {
    console.error('❌ Error obteniendo productos:', err.message);
    res.status(500).json({ error: 'Error obteniendo productos' });
  }
});

// Endpoint para información de garantías
app.get('/garantias', (req, res) => {
  res.json({ garantias: STORE_INFO.garantias });
});

// Endpoint para información de la tienda
app.get('/tienda', (req, res) => {
  res.json({
    nombre: "Sr Robot",
    ubicacion: STORE_INFO.ubicacion,
    direccion: STORE_INFO.direccion,
    horario: "Lunes a Sábado: 9:00 AM - 7:00 PM"
  });
});

// Endpoint para admin
app.get('/admin/data', verifyToken, async (req, res) => {
  const dbData = await getStoreData();
  res.json({ 
    data: dbData,
    storeInfo: STORE_INFO
  });
});

app.listen(PORT, () => {
  console.log(`🚀 API Chatbot Sr Robot corriendo en puerto ${PORT}`);
  console.log(`📍 Ubicación: ${STORE_INFO.direccion}`);
  console.log(`📸 Endpoints disponibles:`);
  console.log(`   POST /chat - Chat con imágenes`);
  console.log(`   POST /images - Obtener imágenes específicas`);
  console.log(`   GET /productos - Lista de productos con imágenes`);
});