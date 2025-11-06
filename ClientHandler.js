import EventEmitter from "events"
import { createClient, states } from "minecraft-protocol"
import { CustomCommands } from "./internalModules/CustomCommands.js"
import { StateHandler } from "./internalModules/StateHandler.js"
import { ConsoleLogger } from "./internalModules/ConsoleLogger.js"
import { TabListHandler } from "./internalModules/TabListHandler.js"
import { AccurateTimer } from "./internalModules/AccurateTimer.js"
import { VisibleBarriers } from "./internalModules/VisibleBarriers.js"

export class ClientHandler extends EventEmitter {
  constructor(userClient, proxy, id) {
    super()

    this.userClient = userClient
    this.proxy = proxy
    this.id = id
    this.proxyClient = createClient({
      host: "hypixel.net",
      username: userClient.username,
      keepAlive: false,
      version: userClient.protocolVersion,
      auth: "microsoft",
      hideErrors: true
    })
    this.sessionLabel = `[ClientHandler ${this.id} - ${this.userClient.username}]`
    console.log(`${this.sessionLabel} Created Hypixel session`)

    //add trimmed UUIDs
    this.userClient.trimmedUUID = this.userClient.uuid.replaceAll("-", "")
    this.proxyClient.trimmedUUID = this.userClient.trimmedUUID

    this.destroyed = false

    this.outgoingModifiers = []
    this.incomingModifiers = []

    this.stateHandler = new StateHandler(this)
    this.customCommands = new CustomCommands(this)
    this.consoleLogger = new ConsoleLogger(this)
    this.tabListHandler = new TabListHandler(this)
    this.accurateTimer = new AccurateTimer(this)
    this.tabListHandler.attachAccurateTimer(this.accurateTimer)
    this.visibleBarriers = new VisibleBarriers(this)

    this.bindEventListeners()
  }

  destroy() {
    if (this.destroyed) return
    this.destroyed = true
    this.proxy.removeClientHandler(this.id)
    this.emit("destroy")
  }

  bindEventListeners() {
    let userClient = this.userClient
    let proxyClient = this.proxyClient
    userClient.on("packet", (data, meta, buffer) => {
      let replaced = false
      for (let modifier of this.outgoingModifiers) {
        let result = modifier(data, meta)
        if (result) {
          let type = result.type
          if (type === "cancel") {
            return
          } else if (type === "replace") {
            data = result.data
            meta = result.meta
            replaced = true
          }
        }
      }
      if (replaced) {
        proxyClient.write(meta.name, data, meta)
      } else {
        proxyClient.writeRaw(buffer)
      }
    })
    proxyClient.on("packet", (data, meta, buffer) => {
      let replaced = false
      for (let modifier of this.incomingModifiers) {
        let result = modifier(data, meta)
        if (result) {
          let type = result.type
          if (type === "cancel") {
            return
          } else if (type === "replace") {
            data = result.data
            meta = result.meta
            replaced = true
          }
        }
      }
      if (meta.state !== states.PLAY) return
      if (replaced) {
        userClient.write(meta.name, data)
      } else {
        userClient.writeRaw(buffer)
      }
    })
    userClient.on("end", (reason) => {
      proxyClient.end()
      this.destroy()
    })
    proxyClient.on("end", (reason) => {
      const formattedReason = reason ?? "<no reason provided>"
      console.log(`${this.sessionLabel} Proxy client connection ended:`, formattedReason)
      userClient.end(`§cProxy lost connection to Hypixel: §r${formattedReason}`)
    })
    userClient.on("error", (err) => {
      if (!err) {
        console.error(`${this.sessionLabel} User client error: <unknown>`)
        return
      }
      console.error(`${this.sessionLabel} User client error:`, err)
      if (err.stack) {
        console.error(`${this.sessionLabel} User client error stack:\n${err.stack}`)
      }
    })
    proxyClient.on("error", (err) => {
      if (!err) {
        console.error(`${this.sessionLabel} Proxy client error: <unknown>`)
        return
      }
      console.error(`${this.sessionLabel} Proxy client error:`, err)
      if (err.stack) {
        console.error(`${this.sessionLabel} Proxy client error stack:\n${err.stack}`)
      }
    })
    //if the proxy client gets kicked while logging in, kick the user client
    proxyClient.once("disconnect", data => {
      if (data) {
        if (data.reason) {
          const { reason } = data
          if (typeof reason === "string") {
            console.log(`${this.sessionLabel} Hypixel disconnect reason (raw string):`, reason)
            try {
              const parsed = JSON.parse(reason)
              console.log(`${this.sessionLabel} Hypixel disconnect reason (parsed JSON):`, JSON.stringify(parsed, null, 2))
            } catch (parseError) {
              console.log(`${this.sessionLabel} Unable to parse disconnect reason JSON:`, parseError.message)
            }
          } else {
            console.log(`${this.sessionLabel} Hypixel disconnect reason (non-string):`, reason)
          }
        } else {
          console.log(`${this.sessionLabel} Hypixel disconnect payload without reason:`, data)
        }
      } else {
        console.log(`${this.sessionLabel} Hypixel disconnect with no payload`)
      }
      userClient.write("kick_disconnect", data)
    })
  }

  sendClientMessage(content) {
    this.userClient.write("chat", {
      position: 1,
      message: JSON.stringify(content),
      sender: "00000000-0000-0000-0000-000000000000"
    })
  }

  sendClientActionBar(content) {
    this.userClient.write("chat", {
      position: 2,
      message: JSON.stringify(content),
      sender: "00000000-0000-0000-0000-000000000000"
    })
  }

  sendServerCommand(content) {
    this.proxyClient.write("chat", {
      message: "/" + content
    })
  }
}