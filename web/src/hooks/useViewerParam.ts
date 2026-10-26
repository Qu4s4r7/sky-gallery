import { useLocation, useNavigate, useSearchParams } from 'react-router'

// El visor vive en la URL (?foto=ID): "Atrás" lo cierra y se puede recargar con la foto abierta
export function useViewerParam() {
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()

  const id = Number(params.get('foto')) || null
  const fromGrid = Boolean((location.state as { fromGrid?: boolean } | null)?.fromGrid)

  // abrir desde la cuadrícula: añade una entrada al historial, así "Atrás" cierra el visor
  const open = (photoId: number) =>
    setParams({ foto: String(photoId) }, { state: { fromGrid: true } })

  // pasar de una foto a otra: reemplaza la entrada actual (no llena el historial)
  const show = (photoId: number) =>
    setParams({ foto: String(photoId) }, { replace: true, state: location.state })

  // cerrar: si se abrió desde la cuadrícula, vuelve atrás; si se entró por enlace directo, solo quita el parámetro
  const close = () => (fromGrid ? navigate(-1) : setParams({}, { replace: true }))

  return { id, open, show, close }
}
