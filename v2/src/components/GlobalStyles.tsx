import { createGlobalStyle } from 'styled-components'
import tw from 'twin.macro'

const CustomStyles = createGlobalStyle({
  body: {
    ...tw`antialiased`,
  },
})

const GlobalStyles = () => (
  <>
    <CustomStyles />
  </>
)

export default GlobalStyles
