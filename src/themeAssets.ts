import earthSplashUrl from '../assets/EarthTheme/splashscreen.png';
import earthIconRoadNormal from '../assets/EarthTheme/Icon-Road-Normal.svg?raw';
import earthIconRoadNarrow from '../assets/EarthTheme/Icon-Road-Narrow.svg?raw';
import earthIconRoadHighway from '../assets/EarthTheme/Icon-Road-Highway.svg?raw';
import earthIconRoundabout from '../assets/EarthTheme/Icon-Roundabout.svg?raw';
import earthIconColor from '../assets/EarthTheme/Icon-Color.svg?raw';
import earthIconHouse from '../assets/EarthTheme/Icon-House.svg?raw';
import earthIconFactory from '../assets/EarthTheme/Icon-Factory.svg?raw';
import earthIconStorage from '../assets/EarthTheme/Icon-Storage.svg?raw';
import earthIconDemolish from '../assets/EarthTheme/Icon-Demolish.svg?raw';
import earthHouseRight from '../assets/EarthTheme/House-Right.svg?raw';
import earthHouseLeft from '../assets/EarthTheme/House-Left.svg?raw';
import earthHouseTop from '../assets/EarthTheme/House-Top.svg?raw';
import earthHouseBottom from '../assets/EarthTheme/House-Bottom.svg?raw';
import earthFactoryRight from '../assets/EarthTheme/Factory-Right.svg?raw';
import earthFactoryLeft from '../assets/EarthTheme/Factory-Left.svg?raw';
import earthFactoryTop from '../assets/EarthTheme/Factory-Top.svg?raw';
import earthFactoryBottom from '../assets/EarthTheme/Factory-Bottom.svg?raw';
import earthStorageRight from '../assets/EarthTheme/Storage-Right.svg?raw';
import earthStorageLeft from '../assets/EarthTheme/Storage-Left.svg?raw';
import earthStorageTop from '../assets/EarthTheme/Storage-Top.svg?raw';
import earthStorageBottom from '../assets/EarthTheme/Storage-Bottom.svg?raw';

import spaceSplashUrl from '../assets/SpaceTheme/splashscreen.png';
import spaceIconRoadNormal from '../assets/SpaceTheme/Icon-Road-Normal.svg?raw';
import spaceIconRoadNarrow from '../assets/SpaceTheme/Icon-Road-Narrow.svg?raw';
import spaceIconRoadHighway from '../assets/SpaceTheme/Icon-Road-Highway.svg?raw';
import spaceIconRoundabout from '../assets/SpaceTheme/Icon-Roundabout.svg?raw';
import spaceIconColor from '../assets/SpaceTheme/Icon-Color.svg?raw';
import spaceIconHouse from '../assets/SpaceTheme/Icon-House.svg?raw';
import spaceIconFactory from '../assets/SpaceTheme/Icon-Factory.svg?raw';
import spaceIconStorage from '../assets/SpaceTheme/Icon-Storage.svg?raw';
import spaceIconDemolish from '../assets/SpaceTheme/Icon-Demolish.svg?raw';
import spaceHouseRight from '../assets/SpaceTheme/House-Right.svg?raw';
import spaceHouseLeft from '../assets/SpaceTheme/House-Left.svg?raw';
import spaceHouseTop from '../assets/SpaceTheme/House-Top.svg?raw';
import spaceHouseBottom from '../assets/SpaceTheme/House-Bottom.svg?raw';
import spaceFactoryRight from '../assets/SpaceTheme/Factory-Right.svg?raw';
import spaceFactoryLeft from '../assets/SpaceTheme/Factory-Left.svg?raw';
import spaceFactoryTop from '../assets/SpaceTheme/Factory-Top.svg?raw';
import spaceFactoryBottom from '../assets/SpaceTheme/Factory-Bottom.svg?raw';
import spaceStorageRight from '../assets/SpaceTheme/Storage-Right.svg?raw';
import spaceStorageLeft from '../assets/SpaceTheme/Storage-Left.svg?raw';
import spaceStorageTop from '../assets/SpaceTheme/Storage-Top.svg?raw';
import spaceStorageBottom from '../assets/SpaceTheme/Storage-Bottom.svg?raw';

type Side = 'right' | 'left' | 'top' | 'bottom';

export interface ThemeAssetBundle {
  splashUrl: string;
  icons: {
    roadNormal: string;
    roadNarrow: string;
    roadHighway: string;
    roundabout: string;
    color: string;
    house: string;
    factory: string;
    storage: string;
    demolish: string;
  };
  sprites: {
    house: Record<Side, string>;
    factory: Record<Side, string>;
    storage: Record<Side, string>;
  };
}

export const earthAssets: ThemeAssetBundle = {
  splashUrl: earthSplashUrl,
  icons: {
    roadNormal: earthIconRoadNormal,
    roadNarrow: earthIconRoadNarrow,
    roadHighway: earthIconRoadHighway,
    roundabout: earthIconRoundabout,
    color: earthIconColor,
    house: earthIconHouse,
    factory: earthIconFactory,
    storage: earthIconStorage,
    demolish: earthIconDemolish,
  },
  sprites: {
    house: {
      right: earthHouseRight,
      left: earthHouseLeft,
      top: earthHouseTop,
      bottom: earthHouseBottom,
    },
    factory: {
      right: earthFactoryRight,
      left: earthFactoryLeft,
      top: earthFactoryTop,
      bottom: earthFactoryBottom,
    },
    storage: {
      right: earthStorageRight,
      left: earthStorageLeft,
      top: earthStorageTop,
      bottom: earthStorageBottom,
    },
  },
};

export const spaceAssets: ThemeAssetBundle = {
  splashUrl: spaceSplashUrl,
  icons: {
    roadNormal: spaceIconRoadNormal,
    roadNarrow: spaceIconRoadNarrow,
    roadHighway: spaceIconRoadHighway,
    roundabout: spaceIconRoundabout,
    color: spaceIconColor,
    house: spaceIconHouse,
    factory: spaceIconFactory,
    storage: spaceIconStorage,
    demolish: spaceIconDemolish,
  },
  sprites: {
    house: {
      right: spaceHouseRight,
      left: spaceHouseLeft,
      top: spaceHouseTop,
      bottom: spaceHouseBottom,
    },
    factory: {
      right: spaceFactoryRight,
      left: spaceFactoryLeft,
      top: spaceFactoryTop,
      bottom: spaceFactoryBottom,
    },
    storage: {
      right: spaceStorageRight,
      left: spaceStorageLeft,
      top: spaceStorageTop,
      bottom: spaceStorageBottom,
    },
  },
};
