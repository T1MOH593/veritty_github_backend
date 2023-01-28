import express from 'express';
import Moralis from 'moralis';
import TelegramBot from 'node-telegram-bot-api';
import "dotenv/config"
import web3 from 'web3';
import { GoogleSpreadsheet } from "google-spreadsheet"
import { Sequelize, DataTypes, Op } from 'sequelize';

const app = express();
const port = 5001;

import { BigNumber } from '@moralisweb3/core';

app.use(express.json());

// const TELEGRAM_BOT_TOKEN: string = process.env.TELEGRAM_BOT_TOKEN || "";
// const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });
const secret = process.env.MORALIS_API_KEY || ""
let privateKey = process.env.GOOGLE_PRIVATE_KEY || ""
privateKey = privateKey.replace(/\\n/gm, "\n")
const CHAT_ID = process.env.CHAT_ID || ""
const SHEET_ID = process.env.SHEET_ID;
const doc = new GoogleSpreadsheet(SHEET_ID);
const dbName = process.env.DB || ""
const dbUser = process.env.DB_USER || ""
const dbPassword = process.env.DB_PASSWORD || ""
const dbHost = process.env.DB_HOST || ""
const dpPort = process.env.DB_PORT || ""

const sequelize = new Sequelize(dbName, dbUser, dbPassword, {
    host: dbHost,
    dialect: 'postgres',
    port: Number(dpPort)
});
sequelize.sync().then(() => {
    app.listen(port, async () => {
        await doc.useServiceAccountAuth({
            private_key: privateKey,
            client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "",
        });
        console.log(`Listening for NFT Transfers`);
        console.log("Сервер ожидает подключения...");
    });
}).catch(err => console.log(err));

const Txn = sequelize.define("txn", {
    id: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false
    },
    link: {
        type: DataTypes.STRING,
        allowNull: false
    },
    sum: {
        type: DataTypes.BIGINT,
        allowNull: false
    },
    userId: {
        type: DataTypes.STRING,
        allowNull: false
    },
    timestamp: {
        type: DataTypes.BIGINT,
        allowNull: false
    }
});
const User = sequelize.define("users", {
    id: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false
    },
    link: {
        type: DataTypes.STRING,
        allowNull: false
    },
    totalTickets: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    totalSum: {
        type: DataTypes.BIGINT,
        allowNull: false
    }
});

const Txns = User.hasMany(Txn, { as: "txns" })
Txn.belongsTo(User,)

app.post("/webhook", async (req, res) => {
    interface WinnerChosen {
        tokenId: BigNumber;
        sum: BigNumber;
        player: string
    }
    // try {
    //     verifySignature(req, secret)
    // } catch (e) {
    //     return res.status(404).json();
    // }

    const webhookData = req.body
    if (webhookData.abi.length !== 0 || webhookData.logs.length !== 0) {
        try {

            await doc.loadInfo()
            const sheet = doc.sheetsByIndex[0]


            const decodedLogs = Moralis.Streams.parsedLogs<WinnerChosen>(webhookData);
            for (let i = 0; i < decodedLogs.length; i++) {
                const tokenId = decodedLogs[0].tokenId.toString()
                let sum = Number(decodedLogs[0].sum.toBigInt())
                const player = decodedLogs[0].player
                const txHash = webhookData.logs[0].transactionHash
                const txTimestamp = webhookData.block.timestamp

                await sheet.addRow({
                    TokenId: tokenId,
                    Sum: sum,
                    Player: player
                });
                const text = `Player ${player} minted Ticket with id ${tokenId} and won ${sum} USDT`
                //                 await bot.sendMessage(CHAT_ID, text)
                const a = await User.findOne({
                    where: {
                        id: player
                    }
                })

                if (a === null) {
                    await User.create({
                        id: player,
                        totalTickets: 1,
                        totalSum: sum,
                        link: "https://goerli.etherscan.io/address/" + player,
                        txns: [
                            {
                                id: txHash,
                                link: "https://goerli.etherscan.io/tx/" + txHash,
                                userId: player,
                                sum: sum,
                                timestamp: txTimestamp
                            }
                        ]
                    }, {
                        include: [{ association: Txns }]
                    })
                } else {
                    let user = await User.findOne({
                        where: { id: player }, include: [User.associations.txns]
                    })
                    await Txn.create({
                        id: txHash,
                        link: "https://goerli.etherscan.io/tx/" + txHash,
                        userId: player,
                        sum: sum,
                        timestamp: txTimestamp
                    })
                    await user.update({
                        totalSum: user.getDataValue("totalSum") + sum,
                        totalTickets: user.getDataValue("totalTickets") + 1
                    }, {
                        where: {
                            id: player
                        }
                    })

                    user = await User.findOne({
                        where: { id: player }, include: [User.associations.txns]
                    })
                    const txns = user.getDataValue("txns")
                    console.log(txns)
                }
            }
        } catch (e) {
            console.log(e)
            return res.status(500).json();
        }

    }
    return res.status(200).json();
});

app.get("/users/:player", async (req, res) => {
    try {
        const player = req.params.player

        const user = await User.findOne({
            where: { id: player }, include: [User.associations.txns]
        })
        if (user !== null) {
            return res.send({
                totalTickets: user.getDataValue("totalTickets"),
                totalSum: user.getDataValue("totalSum"),
                txns: user.getDataValue("txns")
            })
        } else {
            return res.status(404).json()
        }
    } catch (e) {
        console.log(e)
        return res.status(500).json()
    }
})

app.get("/leaderboard", async (req, res) => {
    try {
        let users = await User.findAll()

        users.sort((user1, user2) => user2.getDataValue("totalSum") - user1.getDataValue("totalSum"))

        const end = users.length <= 2 ? users.length : 2
        users = users.slice(0, end)

        return res.send(users)
    } catch (e) {
        console.log(e)
        return res.status(500).json()
    }
})

app.get("/sums", async (req, res) => {
    let txns = await Txn.findAll({
        where: {
            sum: {
                [Op.gt]: 0
            }
        }
    })

    const sumToTxns = {}

    txns.forEach(txn => {
        const sum: number = txn.dataValues.sum
        let txns = sumToTxns[sum]
        if (txns === undefined) {
            txns = []
        }
        txns.push({
            link: txn.dataValues.link,
            id: txn.dataValues.id,
            userId: txn.dataValues.userId,
            sum: txn.dataValues.sum,
        })
        sumToTxns[sum] = txns
    })

    return res.send(sumToTxns)
})

const verifySignature = (req: any, secret: string) => {

    const providedSignature = req.headers["x-signature"]
    if (!providedSignature) throw new Error("Signature not provided")
    const generatedSignature = web3.utils.sha3(JSON.stringify(req.body) + secret)
    if (generatedSignature !== providedSignature) throw new Error("Invalid Signature")

}