import { Test, TestingModule } from '@nestjs/testing';
import { DemergeController } from './demerge.controller';

describe('DemergeController', () => {
  let controller: DemergeController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DemergeController],
    }).compile();

    controller = module.get<DemergeController>(DemergeController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
