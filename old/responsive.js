// RESPONSIVE SIZING --------------------------------------------------------------------------------------------

function windowResized() {
  resizeCanvas(windowWidth, windowHeight)
  document.body.style.position = "fixed"
  document.body.style.padding = 0
  document.body.style.margin = 0
  document.body.style.overflow = "hidden"

  gridSize = gridSizePreset
  resizeImages()
}

// TOUCH DEVICE METHODS FOR GESTURES ------------------------------------------------------------------

// prevent zoom-to-tabs gesture in safari
document.addEventListener("gesturestart", function (e) {
  e.preventDefault()
  document.body.style.zoom = 0.99999
})

// prevent zoom-to-tabs gesture in safari
document.addEventListener("gesturechange", function (e) {
  e.preventDefault()
  document.body.style.zoom = 0.99999
})

// prevent zoom-to-tabs gesture in safari
document.addEventListener("gestureend", function (e) {
  e.preventDefault()
  document.body.style.zoom = 1.0
})

function isTouchDevice() {
  return (
    "ontouchstart" in window ||
    navigator.maxTouchPoints > 0 ||
    navigator.msMaxTouchPoints > 0
  )
}
