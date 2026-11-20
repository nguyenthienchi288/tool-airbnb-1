import { CrawlJobInput, DateWindow, SearchCombination } from '../../common/types';
export declare function generateStrategicDateWindows(baseDate?: Date): DateWindow[];
export declare function buildSearchCombinations(input: CrawlJobInput): {
    combinations: SearchCombination[];
    keywordsCount: number;
    dateWindowsCount: number;
    priceBucketsCount: number;
};
