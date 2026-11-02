export default async function highlight(context, locator) {
  try {
    const elementHandle = await locator.elementHandle();
    if (!elementHandle) return false;

    await locator.evaluate((el) => {
      el.style.outline = "3px solid red";
      el.style.transition = "outline 0.3s ease-in-out";
      setTimeout(() => {
        el.style.outline = "";
      }, 1000);
    });
    return true;
  } catch (e) {
    return false;
  }
}
