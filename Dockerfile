# Use a imagem oficial do Node.js 20
FROM node:20-alpine

# Define o diretório de trabalho dentro do container
WORKDIR /app

# Copia os arquivos de package primeiro (para aproveitar cache do Docker)
COPY package*.json ./

# Instala as dependências
RUN npm install

# Copia o restante do código da aplicação
COPY . .

# Expõe a porta que sua aplicação usa (ajuste se necessário)
EXPOSE 3000

# Comando para rodar a aplicação
CMD ["npm", "start"]
