import express from 'express';
import Moralis from 'moralis';
import TelegramBot from 'node-telegram-bot-api';
import cors from 'cors';
import "dotenv/config"
import web3 from 'web3';
import { GoogleSpreadsheet } from "google-spreadsheet"
import { Sequelize, DataTypes, Op } from 'sequelize';

const app = express();
const port = process.env.PORT || 3001;

import { BigNumber } from '@moralisweb3/core';

app.use(express.json(), cors({
    origin: '*'
}));

const TELEGRAM_BOT_TOKEN: string = process.env.TELEGRAM_BOT_TOKEN || "";
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });
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

// const sequelize = new Sequelize(dbName, dbUser, dbPassword, {
//     host: dbHost,
//     dialect: 'postgres',
//     port: Number(dpPort),

// });
const sequelize = new Sequelize({
    dialect: 'sqlite',
});
const Txn = sequelize.define("txn", {
    id: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false
    },
    tokenId: {
        type: DataTypes.BIGINT,
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
sequelize.sync().then(() => {
    app.listen(port, async () => {
        await doc.useServiceAccountAuth({
            private_key: privateKey,
            client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "",
        });
        await doc.loadInfo()
        console.log(`Listening for NFT Transfers`);
        console.log("Сервер ожидает подключения...");
    });
}).catch(err => console.log(err));



const Txns = User.hasMany(Txn, { as: "txns" })
Txn.belongsTo(User,)

app.post("/webhook", async (req, res) => {
    interface WinnerChosen {
        tokenId: BigNumber;
        sum: BigNumber;
        player: string
    }
//     try {
//         verifySignature(req, secret)
//     } catch (e) {
//         return res.status(404).json();
//     }

    const webhookData = req.body
    if (webhookData.abi.length !== 0 || webhookData.logs.length !== 0) {
        try {
            const decodedLogs = Moralis.Streams.parsedLogs<WinnerChosen>(webhookData);
            for (let i = 0; i < decodedLogs.length; i++) {
                const tokenId = decodedLogs[i].tokenId.toString()
                let sum = Number(decodedLogs[i].sum.toBigInt())
                const player = decodedLogs[i].player
                const txHash = webhookData.logs[i].transactionHash
                const txTimestamp = webhookData.block.timestamp

                const maybeTx = await Txn.findOne({
                    where: {
                        id: txHash
                    }
                })
                if (maybeTx === null && sum !== 0) {
                    const sheet = doc.sheetsByIndex[0]
                    await sheet.addRow({
                        TokenId: tokenId,
                        Sum: sum,
                        Player: player
                    });
                    const link = "https://goerli.etherscan.io/tx/"
                    const text = `Player ${player} won ${sum} USDT ${link}${txHash}`
                    await bot.sendMessage(CHAT_ID, text)
                }
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
                                tokenId: tokenId,
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
                        tokenId: tokenId,
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

        return res.send(users)
    } catch (e) {
        console.log(e)
        return res.status(500).json()
    }
})

app.get("/metadata/:id", async (req, res) => {
    try {
        console.log("TOKEN ID:" + req.params.id)
        const id = Number(req.params.id)
        const tokenIds = [0, 1, 3, 6, 10, 15, 25, 40, 89, 888]
        const sums = [50_000, 20_000, 10_000, 5_000, 2_500, 1_000, 500, 200, 100, 0]
        let sum = 0
        for (let i = 0; i < sums.length; i++) {
            if (tokenIds[i] <= id) {
                sum = sums[i]
            }
        }
        //         var jsonData = `{"name": "Ticket #` + id + `","description": "","image": "ipfs://QmVzJr3ncNipwupCTiSH6fDDUyzwktVbhXrXdPN5pS2RpG/` + sum + `.png","attributes": [{"display_type": "number", , + `}]}`
        var jsonData = {
            'name': "Ticket #" + id,
            'description': "The world's first transparent and honest NFT LOTTERY with instant wins and fast payouts right to your wallet.\n\n - Immediate results, prize fund of 282 700 USDT\n - 888 winning tickets of 10888\n - Payments to the winner's wallet within 24 hours\n - 23 000 USDT - Second Round for No Winners\n\n For more Information - visit verity.io",
            'image': "ipfs://QmVzJr3ncNipwupCTiSH6fDDUyzwktVbhXrXdPN5pS2RpG/" + sum + ".png",
            'attributes': [{
                'display_type': "number",
                'trait_type': "USDT prize",
                'value': sum
            }]
        }
        return res.send(jsonData)

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
            tokenId: txn.dataValues.tokenId,
        })
        sumToTxns[sum] = txns
    })

    return res.send(sumToTxns)
})

app.get("/lastTxns", async (req, res) => {
    let txns = await Txn.findAll({
        where: {
            sum: {
                [Op.gt]: 0
            }
        }
    })

    txns.sort((t1, t2) => t2.getDataValue("timestamp") - t1.getDataValue("timestamp"))
    txns = txns.length <= 10 ? txns : txns.slice(0, 10)

    return res.send(txns)
})

const verifySignature = (req: any, secret: string) => {

    const providedSignature = req.headers["x-signature"]
    if (!providedSignature) throw new Error("Signature not provided")
    const generatedSignature = web3.utils.sha3(JSON.stringify(req.body) + secret)
    if (generatedSignature !== providedSignature) throw new Error("Invalid Signature")

}