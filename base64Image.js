const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

const writeFileAsync = promisify(fs.writeFile);
const mkdirAsync = promisify(fs.mkdir);

/**
 * Extrai o base64 puro de uma string data URI
 */
const extractBase64 = (base64String) => {
  // Remove o prefixo data:image/...;base64, se existir
  if (base64String.includes(',')) {
    return base64String.split(',')[1];
  }
  return base64String;
};

/**
 * Detecta o tipo de imagem do base64
 */
const detectImageType = (base64String) => {
  if (base64String.startsWith('data:image/')) {
    const match = base64String.match(/data:image\/(\w+);base64/);
    return match ? match[1] : 'png';
  }
  
  // Detectar pelo magic number (primeiros bytes)
  const pureBase64 = extractBase64(base64String);
  const buffer = Buffer.from(pureBase64, 'base64');
  const header = buffer.toString('hex', 0, 4);
  
  if (header.startsWith('89504e47')) return 'png';
  if (header.startsWith('ffd8ff')) return 'jpeg';
  if (header.startsWith('47494638')) return 'gif';
  if (header.startsWith('52494646')) return 'webp';
  
  return 'png'; // default
};

/**
 * Converte base64 para PNG e salva em arquivo
 * @param {string} base64String - String base64 da imagem
 * @param {Object} options - Opções de configuração
 * @param {string} options.outputPath - Caminho completo do arquivo de saída
 * @param {string} options.outputDir - Diretório de saída (padrão: './wallpapers')
 * @param {string} options.fileName - Nome do arquivo (padrão: 'wallpaper_timestamp.png')
 * @param {boolean} options.createDir - Criar diretório se não existir (padrão: true)
 * @returns {Promise<string>} Caminho do arquivo salvo
 */
const base64ToPng = async (base64String, options = {}) => {
  try {
    // Configurações padrão
    const outputDir = options.outputDir || './wallpapers';
    const fileName = options.fileName || `wallpaper_${Date.now()}.png`;
    const createDir = options.createDir !== false; // true por padrão
    
    // Caminho completo
    const outputPath = options.outputPath || path.join(outputDir, fileName);
    
    // Criar diretório se não existir
    if (createDir) {
      const dir = path.dirname(outputPath);
      if (!fs.existsSync(dir)) {
        await mkdirAsync(dir, { recursive: true });
        console.log(`✓ Diretório criado: ${dir}`);
      }
    }
    
    // Extrair base64 puro
    const pureBase64 = extractBase64(base64String);
    
    // Converter para buffer
    const imageBuffer = Buffer.from(pureBase64, 'base64');
    
    // Salvar arquivo
    await writeFileAsync(outputPath, imageBuffer);
    
    const fileSizeKB = (imageBuffer.length / 1024).toFixed(2);
    console.log(`✓ Imagem salva: ${outputPath}`);
    console.log(`  Tamanho: ${fileSizeKB} KB`);
    
    return outputPath;
  } catch (error) {
    console.error('✗ Erro ao converter base64 para PNG:', error);
    throw error;
  }
};

/**
 * Versão síncrona da conversão
 */
const base64ToPngSync = (base64String, options = {}) => {
  try {
    const outputDir = options.outputDir || './wallpapers';
    const fileName = options.fileName || `wallpaper_${Date.now()}.png`;
    const createDir = options.createDir !== false;
    
    const outputPath = options.outputPath || path.join(outputDir, fileName);
    
    if (createDir) {
      const dir = path.dirname(outputPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`✓ Diretório criado: ${dir}`);
      }
    }
    
    const pureBase64 = extractBase64(base64String);
    const imageBuffer = Buffer.from(pureBase64, 'base64');
    
    fs.writeFileSync(outputPath, imageBuffer);
    
    const fileSizeKB = (imageBuffer.length / 1024).toFixed(2);
    console.log(`✓ Imagem salva: ${outputPath}`);
    console.log(`  Tamanho: ${fileSizeKB} KB`);
    
    return outputPath;
  } catch (error) {
    console.error('✗ Erro ao converter base64 para PNG:', error);
    throw error;
  }
};

/**
 * Converte base64 para buffer sem salvar
 */
const base64ToBuffer = (base64String) => {
  const pureBase64 = extractBase64(base64String);
  return Buffer.from(pureBase64, 'base64');
};

/**
 * Valida se uma string é base64 válida
 */
const isValidBase64 = (base64String) => {
  try {
    const pureBase64 = extractBase64(base64String);
    return Buffer.from(pureBase64, 'base64').toString('base64') === pureBase64;
  } catch (error) {
    return false;
  }
};

/**
 * Processa wallpaper recebido via WebSocket
 */
const processWallpaperFromWebSocket = async (wsMessage, deviceId) => {
  try {
    const data = JSON.parse(wsMessage);
    
    if (data.type === 'identification' && data.wallpaper) {
      const fileName = `${data.data}_${data.timestamp}.png`;
      const outputPath = await base64ToPng(data.wallpaper, {
        outputDir: './wallpapers',
        fileName: fileName
      });
      
      console.log(`✓ Wallpaper do dispositivo ${deviceId} salvo com sucesso!`);
      return outputPath;
    }
  } catch (error) {
    console.error('✗ Erro ao processar wallpaper do WebSocket:', error);
    throw error;
  }
};

// Exportar funções
module.exports = {
  base64ToPng,
  base64ToPngSync,
  base64ToBuffer,
  extractBase64,
  detectImageType,
  isValidBase64,
  processWallpaperFromWebSocket
};

// =====================================
// EXEMPLOS DE USO
// =====================================

// Exemplo 1: Uso básico
/*
const { base64ToPng } = require('./base64ToPng');

const base64Image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

base64ToPng(base64Image)
  .then(filePath => console.log('Arquivo salvo:', filePath))
  .catch(error => console.error('Erro:', error));
*/

// Exemplo 2: Com opções customizadas
/*
base64ToPng(base64Image, {
  outputDir: './images',
  fileName: 'meu_wallpaper.png'
});
*/

// Exemplo 3: Integração com WebSocket
/*
const WebSocket = require('ws');
const { processWallpaperFromWebSocket } = require('./base64ToPng');

const wss = new WebSocket.Server({ port: 8080 });

wss.on('connection', (ws) => {
  console.log('Cliente conectado');
  
  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      
      if (data.type === 'identification' && data.wallpaper) {
        const filePath = await processWallpaperFromWebSocket(
          message.toString(),
          data.data
        );
        
        // Enviar confirmação
        ws.send(JSON.stringify({
          type: 'wallpaper_received',
          success: true,
          filePath: filePath
        }));
      }
    } catch (error) {
      console.error('Erro ao processar mensagem:', error);
      ws.send(JSON.stringify({
        type: 'error',
        message: error.message
      }));
    }
  });
});

console.log('Servidor WebSocket rodando na porta 8080');
*/

// Exemplo 4: Versão síncrona
/*
const { base64ToPngSync } = require('./base64ToPng');

try {
  const filePath = base64ToPngSync(base64Image, {
    outputDir: './wallpapers',
    fileName: 'wallpaper_sync.png'
  });
  console.log('Arquivo salvo:', filePath);
} catch (error) {
  console.error('Erro:', error);
}
*/

// Exemplo 5: Apenas converter para buffer
/*
const { base64ToBuffer } = require('./base64ToPng');

const buffer = base64ToBuffer(base64Image);
console.log('Buffer gerado:', buffer.length, 'bytes');

// Fazer algo com o buffer (enviar por HTTP, processar, etc)
*/