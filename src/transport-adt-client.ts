import { ADTClient, type HttpClient } from "abap-adt-api"

/** Create transports bound to one endpoint and identity, without shared ADT cookies. */
export type AdtTransportFactory = () => HttpClient

// abap-adt-api 8.4.1 reconstructs statelessClone from baseUrl, which is empty
// for custom transports. Preserve the transport factory and separate ADT sessions.
export class TransportAdtClient extends ADTClient {
  private transportClone: TransportAdtClient | undefined

  constructor(
    private readonly transportFactory: AdtTransportFactory,
    username: string,
    private readonly transportCredential: ConstructorParameters<typeof ADTClient>[2],
    client = "",
    language = ""
  ) {
    super(transportFactory(), username, transportCredential, client, language)
  }

  override get statelessClone(): ADTClient {
    if (this.httpClient.isClone) return this
    if (!this.transportClone) {
      this.transportClone = new TransportAdtClient(
        this.transportFactory, this.username, this.transportCredential, this.client, this.language
      )
      this.transportClone.httpClient.isClone = true
    }
    return this.transportClone
  }

  override async logout(): Promise<void> {
    const results = await Promise.allSettled([
      super.logout(),
      this.transportClone?.loggedin ? this.transportClone.logout() : Promise.resolve()
    ])
    const failure = results.find(result => result.status === "rejected")
    if (failure?.status === "rejected") throw failure.reason
  }
}
