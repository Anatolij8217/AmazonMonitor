/* eslint-disable indent */
import { ActivityType, Client } from 'discord.js'
import fs from 'fs'
import { addWatchlistItem, getWatchlist, removeWatchlistItem } from './watchlist'
import debug from './debug'
import { item, category, search } from './amazon'

const config: Config = JSON.parse(fs.readFileSync('./config.json').toString())

export async function startWatcher(bot: Client) {
  const curRows = await getWatchlist()

  bot.user.setActivity(`${curRows.length} items! | ${config.prefix}help`, {
    type: ActivityType.Watching,
  })

  setInterval(async () => {
    const rows = await getWatchlist()

    debug.log('Checking prices...')

    if (rows.length > 0) doCheck(bot, 0)
  }, config.minutes_per_check * 60 * 1000)
}

export async function doCheck(bot: Client, i: number) {
  const watchlist = await getWatchlist()

  if (i >= watchlist.length) return

  const item = watchlist[i]
  let result: NotificationData[] | null = null

  switch (item.type) {
    case 'link':
      // @ts-ignore we are properly checking the type
      result = itemCheck(item)
      break
    case 'category':
      // @ts-ignore we are properly checking the type
      result = categoryCheck(item)
      break
    case 'query':
      // @ts-ignore we are properly checking the type
      result = queryCheck(item)
      break
  }

  if (!result) {
    setTimeout(() => {
      doCheck(bot, i + 1)
    }, fs.existsSync('proxylist.txt') ? 0 : 5000)

    return
  }
}

async function itemCheck(product: LinkItem) {
  const newData = await item(product.link)
  const newPrice = parseFloat(newData.price.replace(/,/g, '')) || 0

  // Push the price change to the watchlist
  if (newPrice !== product.lastPrice) {
    await removeWatchlistItem(product.link)
    await addWatchlistItem({
      ...product,
      lastPrice: newPrice,
    })
  }

  const underPriceLimit = newPrice <= product.priceLimit

  if (underPriceLimit && product.lastPrice > newPrice) {
    return [
      {
        itemName: newData.fullTitle,
        oldPrice: product.lastPrice,
        newPrice,
        link: product.link,
        guildId: product.guildId,
        channelId: product.channelId,
        priceLimit: product.priceLimit || null,
        pricePercentage: product.pricePercentage || null,
        difference: product.difference || null,
        symbol: newData.symbol,
      }
    ] as NotificationData[]
  }

  return null
}

async function categoryCheck(cat: CategoryItem) {
  let total = 0

  // First, get current items in category for comparison
  const newItems = await category(cat.link)

  // Match items in both arrays and only compare those prices.
  const itemsToCompare = newItems.list.filter((ni) =>
    cat.cache.find((o) => o.asin === ni.asin)
  )

  const notifications: NotificationData[] = []

  // Compare new items to cache and alert on price change
  itemsToCompare.forEach((item) => {
    const matchingObj = cat.cache.find((o) => o.asin === item.asin)

    if (matchingObj.lastPrice === item.lastPrice) return
    total++

    if (item.lastPrice > matchingObj.lastPrice) {
      notifications.push({
        itemName: item.fullTitle,
        oldPrice: matchingObj.lastPrice,
        newPrice: item.lastPrice,
        link: item.fullLink,
        guildId: cat.guildId,
        channelId: cat.channelId,
        priceLimit: cat.priceLimit || null,
        pricePercentage: cat.pricePercentage || null,
        difference: cat.difference || null,
        symbol: item.symbol,
      })
    }
  })

  // Push new list to watchlist
  const addition: CategoryItem = {
    ...cat,
    cache: newItems.list,
  }

  debug.log(`${total} item(s) changed`, 'debug')

  // Remove old stuff
  await removeWatchlistItem(cat.link)
  // Add new stuff
  await addWatchlistItem(addition)

  return notifications
}

async function queryCheck(query: QueryItem) {
  const newItems = await search(query.query, config.tld)
  const itemsToCompare = newItems.filter((ni) =>
    query.cache.find((o) => o.asin === ni.asin)
  )

  const notifications: NotificationData[] = []

  // Compare new items to cache and alert on price change
  itemsToCompare.forEach((item) => {
    const matchingObj = query.cache.find((o) => o.asin === item.asin)

    if (matchingObj.lastPrice === item.lastPrice) return

    if (item.lastPrice > matchingObj.lastPrice) {
      notifications.push({
        itemName: item.fullTitle,
        oldPrice: matchingObj.lastPrice,
        newPrice: item.lastPrice,
        link: item.fullLink,
        guildId: query.guildId,
        channelId: query.channelId,
        priceLimit: query.priceLimit || null,
        pricePercentage: query.pricePercentage || null,
        difference: query.difference || null,
        symbol: item.symbol,
      })
    }
  })

  // Push new list to watchlist
  const addition: QueryItem = {
    ...query,
    cache: newItems,
  }

  // Remove old stuff
  await removeWatchlistItem(query.query)
  // Add new stuff
  await addWatchlistItem(addition)

  return notifications
}