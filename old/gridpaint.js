// Main
var bgColor

// Specific
var imgDrawing
var gridSizePreset = 75
var gridSizeSteps = 25
var gridSize
var brushColor
var gridElementColor
var rasterPoints = []
var magicNr = 0.553
var gridXElements
var gridYElements

//--------------------------------------------------

function preload() {
  bgColor = color(255)
  interfaceColor = color(0)
  brushColor = color(255)
  gridElementColor = color(0)
}

function setup() {
  createCanvas(windowWidth, windowHeight)
  pixelDensity(2)
  document.body.style.backgroundColor = bgColor
  if (isTouchDevice() == true) {
    gridSizePreset *= 0.5
    gridSizeSteps *= 0.5
  }
  gridSize = gridSizePreset
  reset()
  imageMode(CENTER)
}

function draw() {
  display()
  //print(frameRate());
}

//--------------------------------------------------

function display() {
  image(imgDrawing, width / 2, height / 2)
  updateRasterPoints()
  background(bgColor)
  displayRasterPoints()
}

//--------------------------------------------------
var rot = 0.0
function mousePressed() {
  if (mouseX > width - 205 && mouseY < 70) {
  } else if (mouseX > width - 70 && mouseY > height - 260) {
  } else {
    drawImg(mouseX, mouseY, pmouseX, pmouseY)
  }
}

function mouseDragged() {
  if (mouseX > width - 205 && mouseY < 70) {
  } else if (mouseX > width - 70 && mouseY > height - 260) {
  } else {
    drawImg(mouseX, mouseY, pmouseX, pmouseY)
  }
}

function drawImg(x, y, px, py) {
  imgDrawing.stroke(brushColor)
  imgDrawing.strokeWeight(gridSize)
  imgDrawing.noFill()
  imgDrawing.line(x, y, px, py)
}

//--------------------------------------------------

function setColor() {
  var b = color(0)
  var w = color(255)
  if (brightness(brushColor) > 0) {
    brushColor = color(0)
    document.getElementById("colorToggleBlack").style.visibility = "hidden"
    document.getElementById("colorToggleWhite").style.visibility = "visible"
  } else {
    brushColor = color(255)
    document.getElementById("colorToggleBlack").style.visibility = "visible"
    document.getElementById("colorToggleWhite").style.visibility = "hidden"
  }
}

function setGridSize(val) {
  var gridSizeMin = gridSizeSteps * 2
  var gridSizeMax = gridSizeSteps * 6

  if (val == "+") {
    gridSize += gridSizeSteps
  } else if (val == "-") {
    gridSize -= gridSizeSteps
  } else {
    gridSize *= val
    gridSize = round(gridSize / gridSizeSteps) * gridSizeSteps
  }
  gridSize = constrain(gridSize, gridSizeMin, gridSizeMax)

  if (gridSize == gridSizeMin) {
    document.getElementById("gridMinus").style.opacity = "0.3"
  } else if (gridSize == gridSizeMax) {
    document.getElementById("gridPlus").style.opacity = "0.3"
  } else {
    document.getElementById("gridMinus").style.opacity = "1.0"
    document.getElementById("gridPlus").style.opacity = "1.0"
  }

  createRasterPoints()
}

//--------------------------------------------------

function gridify(IN) {
  var OUT = int(round(float(IN) / gridSize) * gridSize)
  return OUT
}

function createRasterPoints() {
  rasterPoints = []
  gridXElements = floor(width / gridSize) + 2
  gridYElements = floor(height / gridSize) + 2
  for (var x = 0; x < gridXElements; x++) {
    rasterPoints[x] = []
    for (var y = 0; y < gridYElements; y++) {
      var xPos =
        x * gridSize + (width - gridSize * gridXElements) / 2 + gridSize / 2
      var yPos =
        y * gridSize + (height - gridSize * gridYElements) / 2 + gridSize / 2
      rasterPoints[x][y] = new RasterPoint(xPos, yPos)
    }
  }
}

function updateRasterPoints() {
  var tempScreen = get(0, 0, width, height)
  tempScreen.resize(int(width / gridSize) * 4, (height / gridSize) * 4)
  var factor = width / tempScreen.width

  for (var x = 0; x < gridXElements; x++) {
    for (var y = 0; y < gridYElements; y++) {
      rasterPoints[x][y].update(tempScreen, factor)
    }
  }
}

function displayRasterPoints() {
  for (var x = 0; x < gridXElements; x++) {
    for (var y = 0; y < gridYElements; y++) {
      rasterPoints[x][y].display()
    }
  }
}

//--------------------------------------------------

function reset() {
  imgDrawing = null
  resizeImages()

  brushColor = color(255)
  document.getElementById("colorToggleBlack").style.visibility = "visible"
  document.getElementById("colorToggleWhite").style.visibility = "hidden"

  imgDrawing.background(0)
}

function resizeImages() {
  if (imgDrawing != null) {
    var imgDrawingTemp = createGraphics(windowWidth, windowHeight)
    var factor
    if (windowWidth > imgDrawing.width || windowHeight > imgDrawing.height)
      factor = max([
        windowWidth / imgDrawing.width,
        windowHeight / imgDrawing.height,
      ])
    else
      factor = min([
        windowWidth / imgDrawing.width,
        windowHeight / imgDrawing.height,
      ])
    imgDrawingTemp.background(0)
    imgDrawingTemp.imageMode(CENTER)
    imgDrawingTemp.image(
      imgDrawing,
      imgDrawingTemp.width / 2,
      imgDrawingTemp.height / 2,
      imgDrawing.width * factor,
      imgDrawing.height * factor,
    )
    imgDrawingTemp.imageMode(CORNER)
    imgDrawing.remove()
    imgDrawing = null
    imgDrawing = imgDrawingTemp
    imgDrawingTemp.remove()
    imgDrawingTemp = null
    setGridSize(factor)
  } else {
    imgDrawing = createGraphics(width, height)
  }
  createRasterPoints()
}

//--------------------------------------------------

function saveIMG() {
  let filename =
    "IMG_" +
    year() +
    "-" +
    month() +
    "-" +
    day() +
    "_" +
    hour() +
    "-" +
    minute() +
    "-" +
    second() +
    "_" +
    round(millis()) +
    ".png"
  display()
  save("" + filename)
  saveCanvasToServer(filename)
}

function saveCanvasToServer(filename) {
  var canvasData = document
    .getElementById("defaultCanvas0")
    .toDataURL("image/png")
  var formData = new FormData()
  var blob = dataURLtoBlob(canvasData)
  formData.append("imageData", blob, filename)
  var xhttp = new XMLHttpRequest()
  xhttp.onreadystatechange = function () {
    if (this.readyState == 4 && this.status == 200) {
      console.log("Image saved.")
    }
  }
  xhttp.open("POST", "saveImage.php", true)
  xhttp.send(formData)
}

function dataURLtoBlob(dataURL) {
  var arr = dataURL.split(",")
  var mime = arr[0].match(/:(.*?);/)[1]
  var bstr = atob(arr[1])
  var n = bstr.length
  var u8arr = new Uint8Array(n)
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n)
  }
  return new Blob([u8arr], { type: mime })
}
