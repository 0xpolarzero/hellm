export type PaletteSectionHeaderProps = {
  title: string;
};

/** Uppercased 10px/700 group header rendered when a result section changes. */
export function PaletteSectionHeader({ title }: PaletteSectionHeaderProps) {
  return <div className="palette-section-header">{title}</div>;
}
