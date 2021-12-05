const qs = require('querystring')

const SteamUser = require('steam-user')
const SteamTotp = require('steam-totp')
const fetch = (...args) =>
  import('node-fetch').then(({ default: fetch }) => fetch(...args))
const express = require('express')
const app = express()

app.get('/', (request, response) => response.sendStatus(200))
app.listen(process.env.PORT)

const { ACCOUNT_NAME, PASSWORD, SHARED_SECRET, STEAM_API_KEY, APPS_ID } =
  process.env

const keyMirror = (array) => (
  (object = {}), array.forEach((element) => (object[element] = element)), object
)

const { Activities, Intervals } = {
  Activities: keyMirror(['PLAYING', 'NOT_PLAYING']),
  Intervals: Array.from(
    { length: 50 },
    () => Math.floor(Math.random() * 50) + 10
  )
}

new (class NotIsPlague extends SteamUser {
  constructor () {
    super({ dataDirectory: null })

    this.playStateBlocked = false
    this.appsID = APPS_ID.split(',').map((gameID) => +gameID)

    this.logOn({
      accountName: ACCOUNT_NAME,
      password: PASSWORD,
      twoFactorCode: SteamTotp.getAuthCode(SHARED_SECRET)
    })

    this.on('loggedOn', this.onLoggedOn)
    this.on('playingState', this.onPlayingState)
    this.on('friendRelationship', this.onFriendRelationship)
    this.on('friendsList', this.onFriendsList)
    this.on('error', this.onError)
  }

  async onLoggedOn () {
    const { games, game_count } = await this.request(
      'IPlayerService',
      'GetOwnedGames',
      1,
      {
        include_appinfo: 1,
      }
    )

    this.print('LOGGED_ON', `profiles/${this.steamID}`)
    this.print('OWNED_GAMES', `${game_count} games found`)

    this.setPersona(SteamUser.EPersonaState.Online)
    this.periodicallyPlayGames(
      games
        .filter(({ appid }) => this.appsID.includes(appid))
        .map(({ appid, name }) => ({ appID: appid, name }))
    )
  }

  onPlayingState (blocked) {
    if (this.playStateBlocked !== blocked) {
      this.playStateBlocked = blocked
    }
  }

  async onFriendRelationship (sender, relationship, previousRelationship) {
    const relationshipUpdate = `{${SteamUser.EFriendRelationship[previousRelationship]} >> ${SteamUser.EFriendRelationship[relationship]}}`

    if (SteamUser.EFriendRelationship.RequestRecipient === relationship) {
      this.print('FRIEND_RELATIONSHIP', `profiles/${sender}`)

      const { users } = await this.getSteamLevels([sender])
      const level = users[sender]

      if (level < 1) {
        this.print(
          'FRIEND_RELATIONSHIP',
          `profiles/${sender} -- Invite ignored, reason: level ${level}.`
        )

        return this.removeFriend(sender)
      }

      this.addFriend(sender, (error, personaName) =>
        this.print(
          'FRIEND_RELATIONSHIP',
          `profiles/${sender} ${
            !error ? `-- ${personaName} ${relationshipUpdate}` : error.message
          }`
        )
      )
    } else if (SteamUser.EFriendRelationship.None === relationship) {
      this.print(
        'FRIEND_RELATIONSHIP',
        `profiles/${sender} ${relationshipUpdate}`
      )
    }
  }

  async onFriendsList () {
    const inviters = Object.keys(this.myFriends).filter(
      (steamID) =>
        this.myFriends[steamID] ===
        SteamUser.EFriendRelationship.RequestRecipient
    )

    if (inviters.length) {
      const { users } = await this.getSteamLevels(inviters)

      this.print(
        'FRIENDS_LIST',
        `${inviters.length} invitation${
          inviters.length > 1 ? 's' : ''
        } received`
      )

      inviters.forEach((inviter, index, self) =>
        setTimeout(() => {
          const level = users[inviter]
          const currentAndTotal = `(${index + 1}/${self.length})`

          if (level >= 1) {
            this.addFriend(inviter, (error, personaName) =>
              this.print(
                'FRIENDS_LIST',
                `profiles/${inviter} ${
                  !error
                    ? `-- ${personaName} ${currentAndTotal}`
                    : error.message
                }`
              )
            )
          } else {
            this.print(
              'FRIENDS_LIST',
              `profiles/${inviter} -- Invite ignored, reason: level ${level}. ${currentAndTotal}`
            )
            this.removeFriend(inviter)
          }
        }, 2555 * index)
      )
    }
  }

  onError (error) {
    if (error.eresult === SteamUser.EResult.LoggedInElsewhere) {
      this.playStateBlocked = true
      setTimeout(() => this.logOn(true), 60 * 5 * 1e3)
    }

    this.print('ERROR', error.message)
  }

  request (iface, method, version = 1, params = {}) {
    params = {
      key: STEAM_API_KEY,
      steamid: this.steamID.toString(),
      ...params
    }

    return fetch(
      `https://api.steampowered.com/${iface}/${method}/v${version}?${qs.stringify(
        params
      )}`
    )
      .then((response) =>
        response.ok ? response.json() : Promise.reject(response)
      )
      .then((data) => data.response)
  }

  periodicallyPlayGames (games) {
    const nested = () => {
      const activity = this.random(Object.values(Activities))
      const interval = this.shiftAndPush(Intervals)
      const { appID, name } = this.random(games)

      this.gamesPlayed(activity === Activities.PLAYING ? appID : [])

      this.print(
        activity === Activities.PLAYING
          ? `${activity} ${appID}/${name}`
          : activity,
        `(${interval} mins)`
      )
      this.print(
        'INTERVAL',
        `${interval} [${Intervals.slice(0, 3)} .. ${interval}]`
      )

      setTimeout(nested, 60 * interval * 1e3)
    }

    setTimeout(nested, 1e3)
  }

  shiftAndPush (array) {
    const value = array.shift()
    array.push(value)

    return value
  }

  random (array) {
    return array[~~(Math.random() * array.length)]
  }

  print (...args) {
    console.log(
      new Date().toLocaleTimeString('en-US', { hour12: false }),
      ...args
    )
  }
})()
