import { Test, TestingModule } from '@nestjs/testing';
import { DemergeService } from './demerge.service';

describe('DemergeService', () => {
  let service: DemergeService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DemergeService],
    }).compile();

    service = module.get<DemergeService>(DemergeService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
