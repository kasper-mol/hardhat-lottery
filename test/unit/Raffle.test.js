const { inputToConfig } = require("@ethereum-waffle/compiler")
const { assert, expect } = require("chai")
const { network, getNamedAccounts, deployments, ethers } = require("hardhat")
const { developmentChains, networkConfig } = require("../../helper-hardhat-config")

!developmentChains.includes(network.name) ? describe.skip : describe("Raffle unit tests", async () => {
  let raffle, vrfCoordinatorV2Mock, raffleEntranceFee, deployer, interval
  const chainId = network.config.chainId

  beforeEach(async () => {
    deployer = (await getNamedAccounts()).deployer
    await deployments.fixture("all")
    raffle = await ethers.getContract("Raffle", deployer)
    vrfCoordinatorV2Mock = await ethers.getContract("VRFCoordinatorV2Mock", deployer)
    raffleEntranceFee = await raffle.getEntranceFee()
    interval = await raffle.getInterval()
  })

  describe("constructor", () => {
    it("Itinitalizes the raffle as intended", async () => {
      const RaffleState = await raffle.getRaffleState()
      assert.equal(RaffleState.toString(), "0")
      assert.equal(interval.toString(), networkConfig[chainId]["interval"])
    })
  })

  describe("enter Raffle", () => {
    it("reverts when you don't pay enough", async () => {
      await expect(raffle.enterRaffle()).to.be.revertedWith("Raffle__NotEnoughETHEntered")
    })
    it("records players when the enter", async () => {
      await raffle.enterRaffle({ value: raffleEntranceFee })
      const playerFromContract = await raffle.getPlayer(0)
      assert.equal(playerFromContract, deployer)
    })
    it("emits an event", async () => {
      await expect(raffle.enterRaffle({ value: raffleEntranceFee })).to.emit(raffle, "RaffleEnter")
    })
    it("does not allow entrance when calculating", async () => {
      await expect(raffle.enterRaffle({ value: raffleEntranceFee }))
      await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
      await network.provider.send("evm_mine", [])
      // pretend to be a keeper
      const txResponse = await raffle.performUpkeep([])
      await expect(raffle.enterRaffle({ value: raffleEntranceFee })).to.be.revertedWith("Raffle__NotOpen")

    })
  })
  describe("checkUpkeep", () => {
    it("returns false if people haven't send ETH", async () => {
      await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
      await network.provider.send("evm_mine", [])
      const { upkeepNeeded } = await raffle.callStatic.checkUpkeep([])
      assert(!upkeepNeeded)
    })
    it("returns false if Raffle is not open", async () => {
      await expect(raffle.enterRaffle({ value: raffleEntranceFee }))
      await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
      await network.provider.send("evm_mine", [])
      await raffle.performUpkeep([])
      const raffleState = await raffle.getRaffleState()
      const { upkeepNeeded } = await raffle.callStatic.checkUpkeep([])
      assert.equal(raffleState.toString(), "1")
      assert.equal(upkeepNeeded, false)
    })
    it("returns false if enough time hasn't passed", async () => {
      await raffle.enterRaffle({ value: raffleEntranceFee })
      await network.provider.send("evm_increaseTime", [interval.toNumber() - 1])
      await network.provider.send("evm_mine", [])
      const { upkeepNeeded } = await raffle.callStatic.checkUpkeep([])
      assert(!upkeepNeeded)
    })
    it("returns true if enough time has passed, has players, eth, and is open", async () => {
      await raffle.enterRaffle({ value: raffleEntranceFee })
      await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
      await network.provider.send("evm_mine", [])
      const { upkeepNeeded } = await raffle.callStatic.checkUpkeep([])
      assert(upkeepNeeded)
    })
  })
  describe("performUpkeep", () => {
    it("can only run when checkUpkeep is true", async () => {
      await raffle.enterRaffle({ value: raffleEntranceFee })
      await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
      await network.provider.send("evm_mine", [])
      const tx = await raffle.performUpkeep([])
      assert(tx)
    })
    it("reverts when checkUpkeep is false", async () => {
      await expect(raffle.performUpkeep([])).to.be.revertedWith("Raffle__UpkeepNotNeeded")
    })
    it("updates raffle state, emits event and calls vrf cordinator", async () => {
      await raffle.enterRaffle({ value: raffleEntranceFee })
      await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
      await network.provider.send("evm_mine", [])
      const txResponse = await raffle.performUpkeep([])
      const txReceipt = await txResponse.wait(1)
      const requestId = txReceipt.events[1].args.requestId
      const raffleState = await raffle.getRaffleState()
      assert(requestId.toNumber() > 0)
      assert(raffleState.toString() == "1")

    })
  })
  describe("fulfillRandomWords", () => {
    beforeEach(async () => {
      await raffle.enterRaffle({ value: raffleEntranceFee })
      await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
      await network.provider.send("evm_mine", [])
    })
    it("can only be called after peformUpkeep", async () => {
      await expect(vrfCoordinatorV2Mock.fulfillRandomWords(0, raffle.address)).to.be.revertedWith("nonexistent request")
      await expect(vrfCoordinatorV2Mock.fulfillRandomWords(1, raffle.address)).to.be.revertedWith("nonexistent request")
    })
  })
})