/** Category icons: the lucide names used in categories.csv, imported one by one so they tree-shake. */
import {
  ArrowLeftRight,
  Banknote,
  Bed,
  Beer,
  Bike,
  Briefcase,
  Building,
  CarTaxiFront,
  CircleHelp,
  CirclePlus,
  Coffee,
  Cpu,
  Dumbbell,
  Fuel,
  Gift,
  Heart,
  House,
  Inbox,
  Landmark,
  Mail,
  Map,
  Package,
  PiggyBank,
  Plane,
  Plug,
  Receipt,
  Route,
  Scissors,
  Send,
  Shirt,
  ShoppingBag,
  ShoppingCart,
  Smartphone,
  Sofa,
  SquareParking,
  Stethoscope,
  Tag,
  Ticket,
  TrainFront,
  Trophy,
  Tv,
  Utensils,
  Wallet,
  Wrench,
  type LucideIcon,
} from 'lucide-react';

const ICONS: Record<string, LucideIcon> = {
  briefcase: Briefcase,
  receipt: Receipt,
  building: Building,
  heart: Heart,
  'plus-circle': CirclePlus,
  'circle-plus': CirclePlus,
  'shopping-cart': ShoppingCart,
  utensils: Utensils,
  coffee: Coffee,
  bike: Bike,
  fuel: Fuel,
  road: Route,
  route: Route,
  'square-parking': SquareParking,
  train: TrainFront,
  'car-taxi': CarTaxiFront,
  wrench: Wrench,
  plane: Plane,
  bed: Bed,
  map: Map,
  home: House,
  house: House,
  plug: Plug,
  sofa: Sofa,
  smartphone: Smartphone,
  cpu: Cpu,
  tv: Tv,
  dumbbell: Dumbbell,
  stethoscope: Stethoscope,
  scissors: Scissors,
  shirt: Shirt,
  trophy: Trophy,
  gift: Gift,
  package: Package,
  'shopping-bag': ShoppingBag,
  ticket: Ticket,
  beer: Beer,
  send: Send,
  inbox: Inbox,
  mail: Mail,
  landmark: Landmark,
  banknote: Banknote,
  'arrow-left-right': ArrowLeftRight,
  'piggy-bank': PiggyBank,
  'help-circle': CircleHelp,
  'circle-help': CircleHelp,
  wallet: Wallet,
  tag: Tag,
};

export function CategoryIcon({
  name,
  size = 16,
  className,
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  const I = ICONS[name] ?? Tag;
  return <I size={size} className={className} aria-hidden="true" strokeWidth={1.9} />;
}

/** All icons a category can use, one tile each. */
export function IconPicker({ value, onPick }: { value: string; onPick: (name: string) => void }) {
  const seen = new Set<LucideIcon>();
  const names = Object.keys(ICONS).filter((n) => {
    if (seen.has(ICONS[n])) return false;
    seen.add(ICONS[n]);
    return true;
  });
  return (
    <div className="grid grid-cols-6 gap-1" role="radiogroup" aria-label="Icon">
      {names.map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={n}
          onClick={() => onPick(n)}
          className={`flex size-11 items-center justify-center rounded-xl ${
            value === n ? 'bg-accent-soft text-accent' : 'text-ink-2 hover:bg-surface-2'
          }`}
        >
          <CategoryIcon name={n} size={20} />
        </button>
      ))}
    </div>
  );
}
