import nconf from "nconf"
import path from "path"

nconf.argv()
     .env()
     //.file({file: '/etc/stub_bot/config.json'});
     .file({ file: path.join(__dirname, 'config.json') });

export default nconf;