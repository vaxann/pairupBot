import TelegramBot, {
    SendMessageOptions,
    User,
    ConstructorOptions,
    EditMessageTextOptions,
    Message
} from "node-telegram-bot-api";
import * as Db from "../database";
import async from "async"

import Log from "../log";
import {callbackify} from "util";
import {IMessageStorage} from "../database";
const log = Log(module);

export function sendOrStore(bot:TelegramBot, chat_id:number, text:string, options?:SendMessageOptions, callback?:(err?:Error|null)=>void):void {
    bot.sendMessage(chat_id, text, options)
        .then(
            (message)=>{
                log.debug("Message sent");
                if (callback) return callback();
            },
            (error)=>{
                log.debug("Error, storing message to send it later");
                Db.storeMessage(chat_id, {action:"send", text: text, options:options}, (err)=>{
                    if (callback && err) return callback(err);
                    if (callback) return callback();

                    if (err) log.error("Error can't to store message");
                });
            });
}

export function sendStored(bot:TelegramBot, chat_id:number):void {
    Db.loadStoredMessages(chat_id, (err, messages)=>{
        if (!messages) return log.debug('No stored messages');
        if (err) return log.error(err);

        async.eachSeries(messages,
            (message:IMessageStorage, callback:(err?:Error)=>void )=>{
                bot.sendMessage(chat_id, message.text, message.options)
                    .then(
                        ()=>{callback()},
                        (err)=>{callback(err)});
            },
            (err)=>{
                if (err) return log.error(err);

                Db.deleteStoredMessages(chat_id, (err)=>{
                    if (err) return log.error(err);

                    log.debug('All stored messages sent');
                });
            });


    });
}