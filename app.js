const express = require("express")
const bodyParser = require("body-parser")
const multer = require("multer")
const cors = require("cors")
const AWS = require("aws-sdk")
require("dotenv").config()

AWS.config.update({
  region: process.env.AWS_REGION,
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
})

const dynamoDb = new AWS.DynamoDB.DocumentClient()
const s3 = new AWS.S3()

const app = express()
const PORT = process.env.PORT || 3000

// Налаштування CORS
app.use(cors())

// Налаштування body-parser
app.use(bodyParser.json())

// Налаштування Multer для завантаження файлів
const storage = multer.memoryStorage() // Зберігати файли в пам'яті
const upload = multer({ storage: storage })

// Читання аніме з бази
const getAnimeListFromDB = async () => {
  const params = {
    TableName: "animix-anime",
  }
  const data = await dynamoDb.scan(params).promise()
  return data.Items
}

// Читання користувачів з DynamoDB
const getUsersFromDB = async () => {
  const params = {
    TableName: "animix-users",
  }
  const data = await dynamoDb.scan(params).promise()
  return data.Items
}

const writeUserToDB = async (user) => {
  const params = {
    TableName: "animix-users",
    Item: user,
  }
  await dynamoDb.put(params).promise()
}

// Запис аніме у DynamoDB
const writeAnimeToDB = async (anime) => {
  const params = {
    TableName: "animix-anime",
    Item: anime,
  }
  await dynamoDb.put(params).promise()
}

// Маршрут для отримання списку аніме
app.get("/anime", async (req, res) => {
  const AnimeList = await getAnimeListFromDB()
  res.json(AnimeList)
})

// Реєстрація користувача
app.post("/register", async (req, res) => {
  const { login, password, nickName, description, telegramNickName } = req.body

  const users = await getUsersFromDB()

  const existingUser = users.find((u) => u.nickname === nickName)
  if (existingUser) {
    return res
      .status(400)
      .json({ message: "User with this nickname already exists" })
  }

  if (!nickName || !password || !login) {
    return res
      .status(400)
      .json({ message: "Login, password, and nickname are required" })
  }

  const registrationDay = new Date()
  const newUser = {
    id: users.length + 1,
    login,
    password,
    nickname: nickName,
    description: description || "",
    registrationDay,
    avatar: "",
    telegramNickName: telegramNickName || "",
    friendsList: [],
    recentlyWatched: [],
    watchTime: 0,
    userCollection: {
      watched: [],
      leaved: [],
      postponed: [],
      inProcess: [],
    },
  }

  await writeUserToDB(newUser)
  res.json(newUser)
})

// // Логін користувача
app.post("/login", async (req, res) => {
  console.log("Request Body:", req.body)
  const { login, password } = req.body
  const users = await getUsersFromDB()
  console.log("Users:", users)
  const user = users.find((u) => u.login === login && u.password === password)
  console.log("Found User:", user)

  if (!user) {
    return res
      .status(404)
      .json({ message: "User not found or credentials are incorrect" })
  }

  res.json(user)
})

// // Оновлення недавно переглянутого
app.put("/users/:userId/updateRecentlyWatched", async (req, res) => {
  const { userId } = req.params
  const { movieId, season, episode } = req.body

  const users = await getUsersFromDB()
  const userIndex = users.findIndex((u) => u.id === parseInt(userId))
  if (userIndex === -1) {
    return res.status(404).json({ message: "User not found" })
  }

  const user = users[userIndex]
  const newRecentlyWatched = { movieId, season, episode }
  const existingIndex = user.recentlyWatched.findIndex(
    (item) =>
      item.movieId === movieId &&
      item.season === season &&
      item.episode === episode
  )

  if (existingIndex === -1) {
    if (user.recentlyWatched.length >= 3) {
      user.recentlyWatched.shift()
    }
    user.recentlyWatched.push(newRecentlyWatched)
  }

  await writeUserToDB(user)
  res.json({ recentlyWatched: user.recentlyWatched })
})

// // Отримання списку користувачів
app.get("/users", async (req, res) => {
  try {
    const users = await getUsersFromDB()
    res.json(users)
  } catch (err) {
    res.status(500).json({ message: "Error reading users" })
  }
})

// // Оновлення колекції користувача
app.put("/users/:userId/updateCollection", async (req, res) => {
  const { userId } = req.params
  const { collectionType, movieId, season, episode } = req.body

  const users = await getUsersFromDB()
  const userIndex = users.findIndex((u) => u.id === parseInt(userId))
  if (userIndex === -1) {
    return res.status(404).json({ message: "User not found" })
  }

  const user = users[userIndex]
  if (!user.userCollection[collectionType]) {
    user.userCollection[collectionType] = []
  }

  const newCollectionItem = { movieId, season, episode }
  const existingIndex = user.userCollection[collectionType].findIndex(
    (item) => item.movieId === movieId
  )

  if (existingIndex === -1) {
    user.userCollection[collectionType].push(newCollectionItem)
  }

  await writeUserToDB(user)
  res.json({ userCollection: user.userCollection })
})

// // Додавання коментаря до аніме
app.put("/anime/:animeId/addComment", async (req, res) => {
  const { animeId } = req.params
  const { userId, reviewComment, rating, avatar, date } = req.body

  const AnimeList = await getAnimeListFromDB()

  // Порівнюй id як рядки
  const anime = AnimeList.find((a) => a.id === animeId)

  if (!anime) {
    return res.status(404).json({ message: "Anime not found" })
  }

  anime.comments.unshift({ userId, reviewComment, rating, avatar, date })
  await writeAnimeToDB(anime)
  res.status(200).json(anime)
})

// // Додавання коментаря користувача
app.put("/users/:userId/addComment", async (req, res) => {
  const { userId } = req.params
  const { animeId, reviewComment, rating, cover, date } = req.body

  const users = await getUsersFromDB()
  const user = users.find((u) => u.id === parseInt(userId))
  if (!user) return res.status(404).json({ message: "User not found" })

  // Перевірити, чи існує масив comments
  if (!user.comments) {
    user.comments = []
  }

  // Додати новий коментар до початку масиву
  user.comments.unshift({ animeId, reviewComment, rating, cover, date })
  await writeUserToDB(user)
  res.status(200).json(user)
})

// Зміна пароля користувача
app.put("/users/:userId/changePassword", async (req, res) => {
  const { userId } = req.params
  const { oldPassword, newPassword } = req.body

  const users = await getUsersFromDB()
  const userIndex = users.findIndex((u) => u.id === parseInt(userId))
  if (userIndex === -1)
    return res.status(404).json({ message: "User not found" })

  const user = users[userIndex]
  if (user.password !== oldPassword) {
    return res.status(400).json({ message: "Old password is incorrect" })
  }

  user.password = newPassword
  await writeUserToDB(user)
  res.status(200).json(user)
})

// Завантаження зображення на Amazon S3
app.post("/upload", upload.single("image"), (req, res) => {
  const params = {
    Bucket: process.env.AWS_BUCKET_NAME,
    Key: `images/${Date.now()}_${req.file.originalname}`,
    Body: req.file.buffer,
    ContentType: req.file.mimetype,
  }

  s3.upload(params, (err, data) => {
    if (err) {
      console.error("Error uploading image:", err)
      return res.status(500).json({ message: "Image upload failed" })
    }

    res.status(200).json({ imageUrl: data.Location })
  })
})

// Роут для оновлення профілю
app.post(
  "/profile",
  upload.fields([{ name: "profilePic" }, { name: "profileBg" }]),
  async (req, res) => {
    const { userId, nickname, description, telegram } = req.body
    const profilePic = req.files["profilePic"]
      ? req.files["profilePic"][0]
      : null
    const profileBg = req.files["profileBg"] ? req.files["profileBg"][0] : null

    const users = await getUsersFromDB()
    const userIndex = users.findIndex((u) => u.id === parseInt(userId))
    if (userIndex === -1)
      return res.status(404).json({ message: "User not found" })

    const user = users[userIndex]
    if (nickname) user.nickname = nickname
    if (description) user.description = description
    if (telegram) user.telegramNickName = telegram

    if (profilePic) {
      const uploadParams = {
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: `profilePics/${userId}/${profilePic.originalname}`,
        Body: profilePic.buffer,
        ContentType: profilePic.mimetype,
      }
      try {
        const data = await s3.upload(uploadParams).promise()
        user.avatar = data.Location
      } catch (error) {
        return res
          .status(500)
          .json({ message: "Error uploading profile picture" })
      }
    }

    if (profileBg) {
      const uploadParams = {
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: `profileBgs/${userId}/${profileBg.originalname}`,
        Body: profileBg.buffer,
        ContentType: profileBg.mimetype,
      }
      try {
        const data = await s3.upload(uploadParams).promise()
        user.profileBg = data.Location
      } catch (error) {
        return res
          .status(500)
          .json({ message: "Error uploading profile background" })
      }
    }

    await writeUserToDB(user)
    res.status(200).json(user)
  }
)

// Слухати на порту
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`)
})
