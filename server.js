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
    products: [],
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

// Endpoint para bienvenida inicial
app.get('/bienvenida', (req, res) => {
  const bienvenida = `¡Bienvenido! Hola, soy Sr. Robot, el asistente virtual de la tienda tecnológica Sr Robot. 😊 

Estoy aquí para ayudarte con:
• Información de productos (laptops, smartphones, tablets, accesorios)
• Precios en soles peruanos (S/)
• Especificaciones técnicas
• Garantías de productos
• Ubicación de la tienda
• Imágenes de productos

¿En qué puedo ayudarte hoy?`;
  res.json({ response: bienvenida });
});

// Endpoint principal del chatbot (MEJORADO)
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

    // PROMPT MEJORADO - Ahora incluye manejo de imágenes y más funcionalidades
    const prompt = `Eres Sr. Robot, el asistente virtual oficial de la tienda tecnológica "Sr Robot" en Huánuco.

INFORMACIÓN DE LA TIENDA:
• Ubicación: ${STORE_INFO.ubicacion}
• Dirección: ${STORE_INFO.direccion}
• Garantías: ${garantiasStr}

TUS CAPACIDADES:
1. Información de productos: precios, especificaciones, disponibilidad
2. Mostrar imágenes de productos cuando el cliente las solicite
3. Información sobre garantías por tipo de producto
4. Información de ubicación y contacto
5. Categorías de productos disponibles

REGLAS ESTRICTAS:
• PRESENTACIÓN: Siempre preséntate como "Sr. Robot" en la primera interacción
• PRECIOS: Usa exclusivamente soles peruanos (S/. o PEN)
• IMÁGENES: Cuando el cliente pida imágenes o fotos:
  - Busca en los datos de productos las URLs de imágenes disponibles
  - Si hay imágenes, menciónalas claramente en tu respuesta
  - Ejemplo: "Aquí tienes las imágenes del producto: [URLs de imágenes]"
• GARANTÍAS: Proporciona información específica de garantías cuando pregunten
• UBICACIÓN: Incluye dirección completa cuando pregunten por ubicación
• FORMATO: Sé conciso pero completo. Usa emojis moderadamente.

DATOS DE PRODUCTOS (incluye imágenes):
${productsStr}

CATEGORÍAS DISPONIBLES:
${categoriesStr}

CONTENIDO WEB ADICIONAL:
${webContent}

RESPUESTAS ESPECÍFICAS:
- Para "imágenes" o "fotos": Proporciona las URLs de imágenes disponibles del producto mencionado
- Para "garantía": Especifica los meses/años según el tipo de producto
- Para "ubicación": Proporciona dirección completa con referencia
- Para "productos": Lista todos los productos disponibles con precios en S/.

Pregunta del cliente: "${message}"

Responde en español, de manera natural y útil. Si no hay información específica, sugiere alternativas.`;

    const response = await ollama.chat({
      model: 'deepseek-v3.1:671b-cloud',
      messages: [
        { role: 'user', content: prompt }
      ],
      stream: false
    });

    // Procesar respuesta para detectar solicitudes de imágenes
    let botResponse = response.message.content;
    let images = [];

    // Buscar productos mencionados en el mensaje para incluir imágenes
    if (message.toLowerCase().includes('imagen') || 
        message.toLowerCase().includes('foto') || 
        message.toLowerCase().includes('visual') ||
        message.toLowerCase().includes('ver ')) {
      
      // Buscar productos relevantes en el mensaje
      storeDataObj.products.forEach(product => {
        const productName = product.nombre || product.name || '';
        if (productName && message.toLowerCase().includes(productName.toLowerCase())) {
          if (product.imagenes && product.imagenes.length > 0) {
            images = images.concat(product.imagenes);
          } else if (product.imagen) {
            images.push(product.imagen);
          } else if (product.image) {
            images.push(product.image);
          }
        }
      });

      // Si no se encontraron imágenes específicas, mostrar algunas imágenes de productos
      if (images.length === 0) {
        storeDataObj.products.slice(0, 3).forEach(product => {
          if (product.imagenes && product.imagenes.length > 0) {
            images = images.concat(product.imagenes.slice(0, 2));
          }
        });
      }
    }

    // Si hay imágenes, asegurarse de que la respuesta las mencione
    if (images.length > 0 && !botResponse.includes('imagen') && !botResponse.includes('foto')) {
      botResponse += `\n\n📸 He encontrado ${images.length} imagen(es) relacionada(s): ${images.join(', ')}`;
    }

    res.json({ 
      response: botResponse,
      images: images,
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

// Nuevo endpoint específico para imágenes
app.post('/images', async (req, res) => {
  const { productName } = req.body;
  
  try {
    const storeDataObj = await getStoreData();
    let images = [];

    if (productName) {
      // Buscar imágenes del producto específico
      storeDataObj.products.forEach(product => {
        const name = product.nombre || product.name || '';
        if (name.toLowerCase().includes(productName.toLowerCase())) {
          if (product.imagenes && product.imagenes.length > 0) {
            images = images.concat(product.imagenes);
          } else if (product.imagen) {
            images.push(product.imagen);
          } else if (product.image) {
            images.push(product.image);
          }
        }
      });
    }

    // Si no se especifica producto, devolver algunas imágenes de muestra
    if (images.length === 0) {
      storeDataObj.products.slice(0, 5).forEach(product => {
        if (product.imagenes && product.imagenes.length > 0) {
          images = images.concat(product.imagenes.slice(0, 1));
        }
      });
    }

    res.json({ 
      product: productName || 'Muestra de productos',
      images: images,
      total: images.length
    });

  } catch (err) {
    console.error('❌ Error obteniendo imágenes:', err.message);
    res.status(500).json({ error: 'Error obteniendo imágenes' });
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
  console.log(`📸 Endpoint de imágenes disponible: POST /images`);
});