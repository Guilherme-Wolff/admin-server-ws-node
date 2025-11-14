
const chalk = require('chalk');

const showLocationInfo = (location) => {
    console.clear();
    console.log(chalk.cyan.bold('🌍  Informações de Localização\n'));
  
    console.log(
      `${chalk.bold('📡 IP:')} ${chalk.yellow(location.query)}`
    );
    console.log(
      `${chalk.bold('🏙️  Cidade:')} ${chalk.green(location.city)}`
    );
    console.log(
      `${chalk.bold('🗺️  Região:')} ${chalk.green(location.regionName)} (${location.region})`
    );
    console.log(
      `${chalk.bold('🇧🇷  País:')} ${chalk.magenta(location.country)} (${location.countryCode})`
    );
    console.log(
      `${chalk.bold('⏰  Fuso horário:')} ${chalk.blue(location.timezone)}`
    );
    console.log(
      `${chalk.bold('🏢  ISP:')} ${chalk.white(location.isp)}`
    );
    console.log(
      `${chalk.bold('🏬  Organização:')} ${chalk.white(location.org)}`
    );
    console.log(
      `${chalk.bold('📍  Coordenadas:')} ${chalk.cyan(`${location.lat}, ${location.lon}`)}`
    );
    console.log(
      `${chalk.bold('📮  CEP:')} ${chalk.gray(location.zip)}`
    );
    console.log(
      `${chalk.bold('🔗  AS:')} ${chalk.yellow(location.as)}`
    );
  
    console.log('\n' + chalk.greenBright.bold('✅ Dados carregados com sucesso!\n'));
  }

  module.exports = { showLocationInfo };