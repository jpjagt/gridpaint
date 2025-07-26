class RasterPoint {
  constructor(x, y) {
    this.position = createVector(x, y)
    this.onOff = []
    for (var i = 0; i <= 2; i++) {
      this.onOff[i] = []
    }
    this.threshold = 50
    //this.checkNeighbours();
    this.elementSize = ceil(gridSize / 2)
  }

  update(tempScreen, factor) {
    // Check neighbours
    for (var y = -1; y <= 1; y++) {
      for (var x = -1; x <= 1; x++) {
        var pointColor = tempScreen.get(
          int((this.position.x + gridSize * x) / factor),
          int((this.position.y + gridSize * y) / factor),
        )
        if (brightness(pointColor) >= this.threshold) {
          this.onOff[x + 1][y + 1] = true
        } else {
          this.onOff[x + 1][y + 1] = false
        }
      }
    }
  }

  display() {
    this.elementSize = gridSize / 2
    push()
    ellipseMode(CENTER)
    translate(this.position.x, this.position.y)
    strokeWeight(2)
    stroke(gridElementColor)
    fill(gridElementColor)

    if (this.onOff[1][1]) {
      ////////////////////////////////// THIS RASTER POINT IS ON

      ////////////////////////////////// DOWN RIGHT
      if (this.onOff[2][1] || this.onOff[2][2] || this.onOff[1][2]) {
        this.element0()
      } else {
        this.element1()
      }

      ////////////////////////////////// DOWN LEFT
      rotate(radians(90))
      if (this.onOff[0][1] || this.onOff[0][2] || this.onOff[1][2]) {
        this.element0()
      } else {
        this.element1()
      }

      ////////////////////////////////// UP LEFT
      rotate(radians(90))
      if (this.onOff[0][1] || this.onOff[0][0] || this.onOff[1][0]) {
        this.element0()
      } else {
        this.element1()
      }

      ////////////////////////////////// UP RIGHT
      rotate(radians(90))
      if (this.onOff[1][0] || this.onOff[2][0] || this.onOff[2][1]) {
        this.element0()
      } else {
        this.element1()
      }
    } else {
      ////////////////////////////////// THIS RASTER POINT IS OFF

      ////////////////////////////////// DOWN RIGHT
      if (this.onOff[2][1] && this.onOff[1][2]) {
        this.element2()
      }

      ////////////////////////////////// DOWN LEFT
      rotate(radians(90))
      if (this.onOff[1][2] && this.onOff[0][1]) {
        this.element2()
      }

      ////////////////////////////////// UP LEFT
      rotate(radians(90))
      if (this.onOff[0][1] && this.onOff[1][0]) {
        this.element2()
      }

      ////////////////////////////////// UP RIGHT
      rotate(radians(90))
      if (this.onOff[1][0] && this.onOff[2][1]) {
        this.element2()
      }
    }
    pop()
    //imageMode(CENTER);
  }

  element0() {
    rect(0, 0, this.elementSize, this.elementSize)
  }

  element1() {
    beginShape()
    vertex(0, 0)
    vertex(this.elementSize, 0)
    bezierVertex(
      this.elementSize,
      this.elementSize * magicNr,
      this.elementSize * magicNr,
      this.elementSize,
      0,
      this.elementSize,
    )
    endShape(CLOSE)
  }

  element2() {
    beginShape()
    vertex(this.elementSize, 0)
    bezierVertex(
      this.elementSize,
      this.elementSize * magicNr,
      this.elementSize * magicNr,
      this.elementSize,
      0,
      this.elementSize,
    )
    vertex(this.elementSize, this.elementSize)
    endShape(CLOSE)
  }
}
