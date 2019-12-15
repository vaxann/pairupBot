import TelegramBot, {
    SendMessageOptions,
    User,
    ConstructorOptions,
    EditMessageTextOptions,
    Message, InlineKeyboardButton
} from "node-telegram-bot-api";
import async, {constant} from "async"
import _ from "lodash";
import { Guid } from "guid-typescript";
import Config from "./config";
import * as Db from "./database";
import {sendOrStore, sendStored} from "./utils"
// @ts-ignore
import Agent from "socks5-https-client/lib/Agent"
import Log from "./log";


const log = Log(module);

enum ActionType {
    imin, cancel, results
}

//TODO: add config validation
const token:string = Config.get('telegram_bot:token');
const options:ConstructorOptions = Config.get('telegram_bot:options');

if (options.request)
    options.request.agentClass = Agent;

const bot = new TelegramBot(token,options);


bot.onText(/^\/pairup\s+([^]+)/, (msg, match)=>{
    const pairingWelcome = (match)?match[1]:"Let't start pairing...";

    if (!msg.from || !msg.from.id) return log.error(new Error('Error with Telegram'));

    if (msg.chat.id === msg.from.id)
        return bot.sendMessage(msg.chat.id, "Извините создать запрос на формирование пар возможно только в общем чате");

    const members : Array<User> = [msg.from];
    const guid = Guid.create().toString();

    // send to Chat
    bot.sendMessage(msg.chat.id, __buildPairingText(pairingWelcome, members,false), __buildButtonsSend(guid,false))
        .then((new_msg)=>{
            const data:Db.IPairingData = {pairingWelcome: pairingWelcome, members :members, message:new_msg};

            Db.saveNewSession(guid, data,(err) => {
                if (err) return log.error(err);
                if (!msg.from || !msg.from.id) return log.error(new Error('Error with Telegram'));

                // send to Admin
                sendOrStore(bot, msg.from.id, __buildAdminText(pairingWelcome, false), __buildAdminButtons(guid,false));

                // send to User
                sendOrStore(bot, msg.from.id, __buildUserText(pairingWelcome));
            });
        });
});

bot.onText(/\/info$|\/start$/, (msg)=>{
    if (!msg.from || !msg.from.id) return log.error(new Error('Error with Telegram'));
    if (msg.chat.id !== msg.from.id) return;
    bot.sendMessage(msg.chat.id, "Бот для распрделения на пары: поможет, когда вам необходимо, например, тайно опредлеить кто-кому дарит подарки на Новый год в комании или семье").then(()=>{
        sendStored(bot, msg.chat.id);
    });
});


bot.on('callback_query', (query) => {
    const msg = query.message;
    if (!msg) return log.error(new Error('Error with Telegram'));

    const user:User =  query.from;

    if (!query.data) return log.error(new Error('No query.data comes'));
    const actionParams = query.data.split("|");
    if (actionParams.length !== 2) return log.error(new Error('No action enough params found'));
    const action: ActionType | undefined  = (<any>ActionType)[actionParams[0]];
    if (action === undefined) return log.error(new Error('No action found'));
    const guid: string = actionParams[1];

    switch (action) {
        case ActionType.imin: {
            __addUser(guid, user, msg);
            break;
        }
        case ActionType.results:{
            __showResults(guid, msg);
            break;
        }
    }
});


function __showResults(guid: string, msg:Message):void {
    Db.loadSession(guid,(err, data)=>{
        if (!data || !data.members) return log.error(new Error('No enough members'));

        bot.editMessageText(__buildPairingText(data.pairingWelcome, data.members,true), __buildButtonsEdit(guid, data.message,true));
        bot.editMessageText(__buildAdminText(data.pairingWelcome, true), __buildAdminButtonsEdit(guid, msg, true));

        const random = _.shuffle(data.members);
        const lastMember = _.last(random);

        if (!lastMember) return Error("No last member");

        async.reduce(random, lastMember,
            (memo, member, callbak:(err?:Error|null, memo?:User)=>void) => {
                if (!memo) return callbak(new Error("Can't find pair"));

                sendOrStore(bot, member.id, __buildResultText(data.pairingWelcome, memo), {parse_mode: 'HTML'}, (err) =>{
                    if (err) return callbak(err);

                    callbak(null, member);
                });

            },
            (err)=>{
                if (err) return log.error(err);
                log.debug("All pairs sent");
            });
    });
}


function __addUser(guid: string, user: TelegramBot.User, msg: TelegramBot.Message):void {
    Db.addUserToSession(guid, user, (err, data) => {
        if (err) return log.error(err);
        if (!data) return log.error("Error no Session Data");

        bot.editMessageText(__buildPairingText(data.pairingWelcome, data.members,false), __buildButtonsEdit(guid, msg,false));

        sendOrStore(bot, user.id, __buildUserText(data.pairingWelcome));
    });
}


function __buildButtonsSend(guid:string, isFinished:boolean):SendMessageOptions {
    return __buildButtons(guid, isFinished);
}

function __buildButtonsEdit(guid:string, msg:Message, isFinished:boolean):EditMessageTextOptions {
    const options:EditMessageTextOptions = <EditMessageTextOptions>__buildButtons(guid, isFinished);

    options.chat_id = msg.chat.id;
    options.message_id = msg.message_id;

    return options;
}

function __buildButtons(guid:string, isFinished:boolean):SendMessageOptions {
    const inline_keyboard:InlineKeyboardButton[][] =  [[{
        text: "Результаты",
        url: "https://t.me/pairup_bot"
    }]];

    if(!isFinished) {
        inline_keyboard.unshift([{
            text: "Участвую",
            callback_data: "imin|" + guid
        }]);
    }

    return {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: inline_keyboard
        }
    };
}


function __buildAdminButtonsEdit(guid:string, msg:Message, isFinished:boolean):EditMessageTextOptions {
    const options:EditMessageTextOptions = <EditMessageTextOptions>__buildAdminButtons(guid, isFinished);

    options.chat_id = msg.chat.id;
    options.message_id = msg.message_id;

    return options;
}

function __buildAdminButtons(guid:string, isFinished:boolean):SendMessageOptions {
    const inline_keyboard:InlineKeyboardButton[][] =  [
        [{
            text: "Завершить",
            callback_data: "results|" + guid
        }]];

    const options: SendMessageOptions = {parse_mode: 'HTML'};

    if(!isFinished)
        options.reply_markup = {inline_keyboard: inline_keyboard};

    return options;
}


function __buildResultText(pairingWelcome: string, member: User) {
    return `Результат распредления для "${pairingWelcome}", ваша пара:\n  - ${__userToText(member)}`;
}

function __buildPairingText(pairingWelcome: string, members: Array<User>, isFinished:boolean) : string {
    const users = _
            .chain(members)
            .map((m)=>{return '  - '+ __userToText(m)})
            .join('\n')
            .value();

    const finishText = (isFinished)?"\n\nРаспредление уже завершено, посмотрите результат":"\n\nПодтвердите участие?";

    return `${pairingWelcome}\n\nВ распределении на пары участвуют:\n${users}${finishText}`
}

function __userToText(user:User):string {
    let text = user.first_name;

    if (user.last_name)
        text += ` ${user.last_name}`;

    if (user.username)
        text += ` (@${user.username})`;
    else
        text += ` (<a href="tg://user?id=${user.id}">${user.first_name}</a>)`;

    return text;
}

function __buildAdminText(pairingWelcome: string, isFinished:boolean): string {
    if (isFinished)
        return `Вы завершили распределение "${pairingWelcome}"`;

    return `Вы создали новое распределение "${pairingWelcome}", когда соберется нужное кол-во участников, завершите его`;
}

function __buildUserText(pairingWelcome: string): string {
    return `Вы подтвердили, что участвуете в распределении на пары "${pairingWelcome}", когда все подтвердят участие, здесь вы увидете вашу пару`;
}