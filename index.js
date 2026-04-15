const express = require('express')

const mongoose = require('mongoose')
const cors = require('cors')
const http = require("http")
const dotenv = require('dotenv')
const authRoutes = require("./routes/auth")
const {Server} = require("socket.io")
const Messages = require("./models/Messages")
const ChatUser = require('./models/user')
dotenv.config();
const app = express()
const server = http.createServer(app)
const io = new Server(server, 
    {
        cors: {
            origin: "http://localhost:5173",
        }
    })

app.use(cors())
app.use(express.json())

mongoose.connect(process.env.MONGO_URI)

.then(() => console.log("Mongodb connected."))
.catch((error) => console.error(error))

app.use('/auth', authRoutes);


// socket io logic
let mappedUsers = {}

io.on("connection", (socket) => {
    console.log("User connected", socket.id);

    socket.on("newUser", (username) => {
        mappedUsers[username] = socket.id 
        mappedUsers[socket.id] = username
    })

    socket.on("send_message", async(data) => {
        const {sender, receiver, message, createdAt, status, tempId} = data;
        const newMessage = new Messages({sender, receiver, message, status, tempId});
        const savedMessage = await newMessage.save();

        io.to(mappedUsers[sender]).emit("receive_message", savedMessage);

        if(mappedUsers[receiver]){
            io.to(mappedUsers[receiver]).emit("receive_message", savedMessage);
        }
    });

    socket.on("typing", (data) => {
        if(data.receiver){
            io.to(mappedUsers[data.receiver]).emit("typing", data)
        }
    })

    socket.on("stop_typing", (data) => {
        if(data.receiver){
            io.to(mappedUsers[data.receiver]).emit("stop_typing", data)
        }
    })

    socket.on("message_delivered", async (data) => {
        const updatedMessage = await Messages.findOneAndUpdate({_id: data._id}, {$set: {status: "delivered"}}, {new: true})
        if(mappedUsers[updatedMessage.sender]){
            io.to(mappedUsers[updatedMessage.sender]).emit("message_delivered", {...updatedMessage.toObject()})
        }
    })

    socket.on("message_seen", async (data) => {
    const id = new mongoose.Types.ObjectId(data.lastMsgId)

    await Messages.updateMany(
        { sender: data.sender, receiver: data.receiver, _id: { $lte: id }, status: {$ne: "seen"}},
        { $set: { status: "seen" } }
    );

    if (mappedUsers[data.sender]) {
        io.to(mappedUsers[data.sender]).emit(
        "message_seen_update",
        {sender: data.sender, receiver: data.receiver, lastMsgId: id.toString()}
        );
    }
    });


    socket.on("disconnect", () => {
        console.log("User disconnected", socket.id)
        
        delete mappedUsers[mappedUsers[socket.id]]
        delete mappedUsers[socket.id]
    })
});

app.get("/messages", async(req, res) => {
    const {sender, receiver} = req.query;

    try {
        const messages = await Messages.find({
            $or: [
                {sender, receiver},
                {sender: receiver, receiver: sender},
            ]
        }).sort({createdAt: 1})

        res.json(messages)
    } catch (error) {
        res.status(500).json({message: "Error fetching messages"})
    }
})


app.get("/users", async (req, res) => {
    const {currentUser} = req.query;
    try {
        const users = await ChatUser.find({username: {$ne: currentUser}})
        res.json(users)
    } catch (error) {
        res.status(500).json({message: "Error fetching users."})
    }
})


const PORT = process.env.PORT || 5001;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`))