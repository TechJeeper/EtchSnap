declare module 'imagetracerjs' {
  interface TracerOptions {
    ltres?: number
    qtres?: number
    pathomit?: number
    colorsampling?: number
    numberofcolors?: number
    mincolorratio?: number
    pal?: Array<{ r: number; g: number; b: number; a: number }>
    strokewidth?: number
    linefilter?: boolean
    rightangleenhance?: boolean
    scale?: number
    roundcoords?: number
    layering?: number
    viewbox?: boolean
    desc?: boolean
  }

  const ImageTracer: {
    imageToSVG: (
      url: string,
      callback: (svgString: string) => void,
      options?: TracerOptions | string,
    ) => void
    imagedataToSVG: (
      imageData: ImageData,
      options?: TracerOptions | string,
    ) => string
  }

  export default ImageTracer
}
