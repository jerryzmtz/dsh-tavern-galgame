// private fork: hit-test the real help layer on hover and keyboard Tab, including pointer-transparent tooltips.
export async function checkHelpPopover(page, trigger) {
  const results = []
  const topmost = async mode => {
    const tip = page.locator('.fork-popover.fork-help-tip-body, .ap-help-tip:visible').last()
    await tip.waitFor({ state: 'visible' })
    await page.waitForTimeout(160)
    const result = await tip.evaluate(el => {
      const r = el.getBoundingClientRect(), previous = el.style.pointerEvents
      // Shared tooltips deliberately ignore pointers; enable hit testing only for this paint-order probe.
      el.style.pointerEvents = 'auto'
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
      el.style.pointerEvents = previous
      return { topmost: !!hit && el.contains(hit), width: r.width, height: r.height, hit: hit?.className }
    })
    if (!result.topmost || !result.width || !result.height) throw new Error('help popover ' + mode + ' is not topmost: ' + JSON.stringify(result))
    results.push({ mode, ...result })
  }
  await trigger.hover()
  await topmost('hover')
  await page.mouse.move(0, 0)
  await trigger.focus()
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Tab')
  if (!(await trigger.evaluate(el => el === document.activeElement))) throw new Error('Tab did not focus help trigger')
  await topmost('Tab')
  return results
}
