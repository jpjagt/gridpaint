import { atom } from 'nanostores'

export const showActiveLayerOutline = atom<boolean>(true)

export const toggleActiveLayerOutline = () => {
  showActiveLayerOutline.set(!showActiveLayerOutline.get())
}