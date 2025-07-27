import tw from 'twin.macro'

export const H1 = tw.h1`scroll-m-20 text-4xl font-extrabold tracking-tight lg:text-5xl`

export const H2 = tw.h2`scroll-m-20 text-3xl font-semibold tracking-tight first:mt-0`

export const H3 = tw.h3`scroll-m-20 text-2xl font-semibold tracking-tight`

export const H4 = tw.h4`scroll-m-20 text-xl font-semibold tracking-tight`

export const H5 = tw.h5`scroll-m-20 text-lg font-semibold tracking-tight`

export const P = tw.p`leading-7 [&:not(:first-child)]:mt-6`

export const Blockquote = tw.blockquote`mt-6 border-l-2 pl-6 italic`

export const InlineCode = tw.code`relative rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-sm font-semibold`

export const Large = tw.p`text-lg font-semibold`

export const Small = tw.p`text-sm font-medium leading-none`

export const Lead = tw.p`text-xl text-muted-foreground`

export const Muted = tw.p`text-sm text-muted-foreground`

export const Ul = tw.ul`ml-6 list-disc [&>li]:mt-2`
