import { Reader } from '@/components/reader/Reader'

export default async function ReaderPage(props: PageProps<'/reader'>) {
  const raw = (await props.searchParams).url
  const url = typeof raw === 'string' ? raw : ''
  return <Reader key={url} url={url} />
}
